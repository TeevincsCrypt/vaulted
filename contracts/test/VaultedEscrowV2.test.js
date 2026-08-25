const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers')
const { State, ReleaseTrigger, HOUR, DAY, usdc, saltFor } = require('./helpers')

/**
 * What v2 adds, and the reasons it adds it.
 *
 * The lifecycle itself is inherited from v1 and covered by that contract's suites; repeating it
 * here would test the same code twice. These are the two changes and the ways they could go wrong:
 *
 *   createEscrowFor  — the client creates the escrow and names the freelancer. The whole point is a
 *                      freelancer who holds nothing, so the central test spends a wallet down to
 *                      exactly zero and takes it from hired to paid without ever topping it up.
 *   native escrows   — one deployment now serves ether as well as the token. Ether hands control to
 *                      the recipient on payout, which the token does not, so the recipient is given
 *                      every opportunity to misbehave.
 *
 * And the id scheme, which is what makes createEscrowFor safe to expose at all.
 */
describe('VaultedEscrowV2', function () {
  const NATIVE = ethers.ZeroAddress

  async function deployFixture() {
    const [deployer, payee, payer, stranger, arbiter] = await ethers.getSigners()

    const token = await (await ethers.getContractFactory('MockUSDC')).deploy(6)
    const escrow = await (
      await ethers.getContractFactory('VaultedEscrowV2')
    ).deploy(await token.getAddress(), arbiter.address)

    for (const account of [payer, stranger]) {
      await token.mint(account.address, usdc(1_000_000))
      await token.connect(account).approve(await escrow.getAddress(), ethers.MaxUint256)
    }

    return { escrow, token, deployer, payee, payer, stranger, arbiter }
  }

  /** Creates via the client-pays route and returns the id, mirroring what the app does. */
  async function createFor(escrow, payer, payee, overrides = {}) {
    const params = {
      asset: NATIVE,
      amount: ethers.parseEther('1'),
      protectionPeriod: 0,
      fundingDeadline: 0,
      detailsHash: ethers.ZeroHash,
      salt: saltFor(`invoice-${Math.random()}`),
      ...overrides,
    }
    const escrowId = await escrow.computeEscrowId(payee.address, payer.address, params.salt)
    const tx = await escrow
      .connect(payer)
      .createEscrowFor(
        payee.address,
        params.asset,
        params.amount,
        params.protectionPeriod,
        params.fundingDeadline,
        params.detailsHash,
        params.salt,
      )
    return { escrowId, tx, params }
  }

  // -------------------------------------------------------------------
  describe('the freelancer never has to spend anything', function () {
    it('takes a wallet with a zero balance from hired to paid', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)

      /*
        Not "almost nothing" — nothing. The wallet is drained to exactly zero and asserted so,
        because the failure this contract exists to fix is not that gas is expensive. It is that a
        balance of zero cannot pay a fee of any size, however small.
      */
      await ethers.provider.send('hardhat_setBalance', [payee.address, '0x0'])
      expect(await ethers.provider.getBalance(payee.address)).to.equal(0n)

      const amount = ethers.parseEther('2')
      const { escrowId } = await createFor(escrow, payer, payee, { amount })
      await escrow.connect(payer).fund(escrowId, { value: amount })
      await escrow.connect(payer).release(escrowId)

      // Paid in full, and the only transactions in the whole flow were the client's.
      expect(await ethers.provider.getBalance(payee.address)).to.equal(amount)
    })

    it('pays a freelancer who holds nothing even if the client goes silent', async function () {
      const { escrow, payer, payee, stranger } = await loadFixture(deployFixture)
      const amount = ethers.parseEther('1')
      const { escrowId } = await createFor(escrow, payer, payee, { amount })
      await escrow.connect(payer).fund(escrowId, { value: amount })

      const before = await ethers.provider.getBalance(payee.address)
      await time.increase(DAY + 1)
      // Permissionless: a third party settles it, so the payee still needs no balance of their own.
      await escrow.connect(stranger).executeTimeout(escrowId)

      expect(await ethers.provider.getBalance(payee.address)).to.equal(before + amount)
      expect(await escrow.stateOf(escrowId)).to.equal(State.Released)
    })

    it('makes the creator the payer and the named account the payee', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)
      const { escrowId } = await createFor(escrow, payer, payee)
      const stored = await escrow.getEscrow(escrowId)
      expect(stored.payee).to.equal(payee.address)
      expect(stored.payer).to.equal(payer.address)
    })

    it('still lets the freelancer create one themselves', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)
      const salt = saltFor('freelancer-created')
      const amount = ethers.parseEther('1')
      await escrow.connect(payee).createEscrow(payer.address, NATIVE, amount, 0, 0, ethers.ZeroHash, salt)

      // The same id either route produces: it is derived from the pair, not from who called.
      const escrowId = await escrow.computeEscrowId(payee.address, payer.address, salt)
      const stored = await escrow.getEscrow(escrowId)
      expect(stored.payee).to.equal(payee.address)
      expect(stored.payer).to.equal(payer.address)
    })

    it('refuses an escrow that names the caller on both sides', async function () {
      const { escrow, payer } = await loadFixture(deployFixture)
      await expect(
        escrow
          .connect(payer)
          .createEscrowFor(payer.address, NATIVE, ethers.parseEther('1'), 0, 0, ethers.ZeroHash, saltFor('self')),
      ).to.be.revertedWithCustomError(escrow, 'PayerIsPayee')
    })

    it('refuses a zero payee', async function () {
      const { escrow, payer } = await loadFixture(deployFixture)
      await expect(
        escrow
          .connect(payer)
          .createEscrowFor(ethers.ZeroAddress, NATIVE, ethers.parseEther('1'), 0, 0, ethers.ZeroHash, saltFor('z')),
      ).to.be.revertedWithCustomError(escrow, 'InvalidPayee')
    })
  })

  // -------------------------------------------------------------------
  describe('ids are namespaced by both parties', function () {
    it('lets nobody outside the pair occupy their id', async function () {
      const { escrow, payer, payee, stranger } = await loadFixture(deployFixture)
      const salt = saltFor('contested')
      const target = await escrow.computeEscrowId(payee.address, payer.address, salt)

      /*
        The squatting attempt. A stranger who has seen the payment link knows the payee and the
        salt, and under v1's payee-and-salt scheme that was the whole id — so they could create a
        junk escrow on it and, because ids are never reopened, kill it permanently. Here their
        escrow lands on an id of their own and the real pair's is untouched.
      */
      await escrow
        .connect(stranger)
        .createEscrowFor(payee.address, NATIVE, ethers.parseEther('1'), 0, 0, ethers.ZeroHash, salt)
      expect(await escrow.stateOf(target)).to.equal(State.None)

      await createFor(escrow, payer, payee, { salt })
      expect(await escrow.stateOf(target)).to.equal(State.Created)
    })

    it('still refuses a genuine duplicate from the same pair', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)
      const salt = saltFor('once-only')
      await createFor(escrow, payer, payee, { salt })
      await expect(createFor(escrow, payer, payee, { salt })).to.be.revertedWithCustomError(
        escrow,
        'EscrowAlreadyExists',
      )
    })

    it('derives the id the same way off chain', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)
      const salt = saltFor('derivable')
      const { chainId } = await ethers.provider.getNetwork()

      // Exactly what the application computes before it has sent anything.
      const expected = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'address', 'address', 'address', 'bytes32'],
          [chainId, await escrow.getAddress(), payee.address, payer.address, salt],
        ),
      )
      expect(await escrow.computeEscrowId(payee.address, payer.address, salt)).to.equal(expected)
    })
  })

  // -------------------------------------------------------------------
  describe('native escrows', function () {
    it('runs the full lifecycle in ether', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)
      const amount = ethers.parseEther('3')
      const { escrowId } = await createFor(escrow, payer, payee, { amount })

      await escrow.connect(payer).fund(escrowId, { value: amount })
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(amount)
      expect(await escrow.totalLocked(NATIVE)).to.equal(amount)

      const before = await ethers.provider.getBalance(payee.address)
      await escrow.connect(payer).release(escrowId)

      expect(await ethers.provider.getBalance(payee.address)).to.equal(before + amount)
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0)
      expect(await escrow.totalLocked(NATIVE)).to.equal(0)
    })

    it('refunds ether to the payer', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)
      const amount = ethers.parseEther('1')
      const { escrowId } = await createFor(escrow, payer, payee, { amount })
      await escrow.connect(payer).fund(escrowId, { value: amount })

      const before = await ethers.provider.getBalance(payer.address)
      const tx = await escrow.connect(payee).refund(escrowId)
      const receipt = await tx.wait()
      const spent = receipt.gasUsed * receipt.gasPrice

      // The payee pays for the refund transaction; the payer gets the whole escrow back.
      expect(await ethers.provider.getBalance(payer.address)).to.equal(before + amount)
      expect(await escrow.totalLocked(NATIVE)).to.equal(0)
      expect(spent).to.be.greaterThan(0n)
    })

    it('splits a disputed ether escrow between both sides', async function () {
      const { escrow, payer, payee, arbiter } = await loadFixture(deployFixture)
      const amount = ethers.parseEther('4')
      const { escrowId } = await createFor(escrow, payer, payee, { amount })
      await escrow.connect(payer).fund(escrowId, { value: amount })
      await escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)

      const payeeBefore = await ethers.provider.getBalance(payee.address)
      const payerBefore = await ethers.provider.getBalance(payer.address)
      const share = ethers.parseEther('3')
      await escrow.connect(arbiter).resolveDispute(escrowId, share, ethers.ZeroHash)

      expect(await ethers.provider.getBalance(payee.address)).to.equal(payeeBefore + share)
      expect(await ethers.provider.getBalance(payer.address)).to.equal(payerBefore + (amount - share))
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0)
    })

    it('requires the value sent to match the escrow exactly', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)
      const amount = ethers.parseEther('1')
      const { escrowId } = await createFor(escrow, payer, payee, { amount })

      for (const value of [amount - 1n, amount + 1n, 0n]) {
        await expect(escrow.connect(payer).fund(escrowId, { value })).to.be.revertedWithCustomError(
          escrow,
          'NativeValueMismatch',
        )
      }
      // The escrow is still fundable afterwards: a rejected attempt changed nothing.
      await escrow.connect(payer).fund(escrowId, { value: amount })
      expect(await escrow.stateOf(escrowId)).to.equal(State.Funded)
    })

    it('refuses ether sent alongside a token escrow', async function () {
      const { escrow, token, payer, payee } = await loadFixture(deployFixture)
      const { escrowId } = await createFor(escrow, payer, payee, {
        asset: await token.getAddress(),
        amount: usdc(500),
      })
      await expect(
        escrow.connect(payer).fund(escrowId, { value: 1n }),
      ).to.be.revertedWithCustomError(escrow, 'NativeValueNotAccepted')
    })

    it('has no way for ether to arrive except funding', async function () {
      const { escrow, payer } = await loadFixture(deployFixture)
      // No receive(), no fallback: a plain send reverts, so the contract never holds untracked ether.
      await expect(
        payer.sendTransaction({ to: await escrow.getAddress(), value: ethers.parseEther('1') }),
      ).to.be.reverted
    })

    it('keeps the two assets accounted for separately', async function () {
      const { escrow, token, payer, payee, stranger } = await loadFixture(deployFixture)
      const ether = ethers.parseEther('2')
      const tokens = usdc(750)

      const a = await createFor(escrow, payer, payee, { amount: ether })
      await escrow.connect(payer).fund(a.escrowId, { value: ether })
      const b = await createFor(escrow, stranger, payee, {
        asset: await token.getAddress(),
        amount: tokens,
      })
      await escrow.connect(stranger).fund(b.escrowId)

      expect(await escrow.totalLocked(NATIVE)).to.equal(ether)
      expect(await escrow.totalLocked(await token.getAddress())).to.equal(tokens)

      // Settling one must not disturb the other's accounting.
      await escrow.connect(payer).release(a.escrowId)
      expect(await escrow.totalLocked(NATIVE)).to.equal(0)
      expect(await escrow.totalLocked(await token.getAddress())).to.equal(tokens)
    })

    it('refuses any asset other than ether and the deployment token', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)
      const rogue = await (await ethers.getContractFactory('MockUSDC')).deploy(18)
      await expect(
        escrow
          .connect(payer)
          .createEscrowFor(payee.address, await rogue.getAddress(), usdc(1), 0, 0, ethers.ZeroHash, saltFor('rogue')),
      ).to.be.revertedWithCustomError(escrow, 'UnsupportedAsset')
    })
  })

  // -------------------------------------------------------------------
  describe('paying an address that fights back', function () {
    it('reverts the settlement rather than losing the money', async function () {
      const { escrow, payer } = await loadFixture(deployFixture)
      const hostile = await (await ethers.getContractFactory('RejectsNative')).deploy()
      const amount = ethers.parseEther('1')
      const salt = saltFor('rejects')

      await escrow
        .connect(payer)
        .createEscrowFor(await hostile.getAddress(), NATIVE, amount, 0, 0, ethers.ZeroHash, salt)
      const escrowId = await escrow.computeEscrowId(await hostile.getAddress(), payer.address, salt)
      await escrow.connect(payer).fund(escrowId, { value: amount })

      /*
        A payee that refuses payment must not let the escrow record itself as settled. The whole
        settlement reverts, so the escrow stays funded and the ether stays in the contract, still
        owed and still reachable — rather than a Released escrow with nothing having moved.
      */
      await expect(escrow.connect(payer).release(escrowId)).to.be.revertedWithCustomError(
        escrow,
        'NativeTransferFailed',
      )
      expect(await escrow.stateOf(escrowId)).to.equal(State.Funded)
      expect(await escrow.totalLocked(NATIVE)).to.equal(amount)
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(amount)
    })

    it('cannot re-enter the escrow while being paid', async function () {
      const { escrow, payer } = await loadFixture(deployFixture)
      const attacker = await (await ethers.getContractFactory('ReentrantNativeRecipient')).deploy()
      const amount = ethers.parseEther('1')
      const salt = saltFor('reentrant')

      await escrow
        .connect(payer)
        .createEscrowFor(await attacker.getAddress(), NATIVE, amount, 0, 0, ethers.ZeroHash, salt)
      const escrowId = await escrow.computeEscrowId(await attacker.getAddress(), payer.address, salt)
      await escrow.connect(payer).fund(escrowId, { value: amount })
      await attacker.arm(await escrow.getAddress(), escrowId)

      await time.increase(DAY + 1)
      await escrow.connect(payer).executeTimeout(escrowId)

      // It got control and used it, and got nowhere: paid exactly once.
      expect(await attacker.attempted()).to.equal(true)
      expect(await attacker.reentered()).to.equal(false)
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(amount)
      expect(await escrow.totalLocked(NATIVE)).to.equal(0)
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0)
    })
  })

  // -------------------------------------------------------------------
  describe('rescue', function () {
    it('can never reach escrowed ether', async function () {
      const { escrow, payer, payee, arbiter } = await loadFixture(deployFixture)
      const amount = ethers.parseEther('2')
      const { escrowId } = await createFor(escrow, payer, payee, { amount })
      await escrow.connect(payer).fund(escrowId, { value: amount })

      // Everything the contract holds is spoken for, so there is nothing to rescue at all.
      await expect(escrow.connect(arbiter).rescue(NATIVE, arbiter.address)).to.be.revertedWithCustomError(
        escrow,
        'NothingToRescue',
      )
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(amount)
    })

    it('is the arbiter\'s alone', async function () {
      const { escrow, stranger } = await loadFixture(deployFixture)
      await expect(escrow.connect(stranger).rescue(NATIVE, stranger.address)).to.be.revertedWithCustomError(
        escrow,
        'NotArbiter',
      )
    })
  })

  // -------------------------------------------------------------------
  describe('funding is the named payer\'s alone', function () {
    it('refuses a stranger with the right money', async function () {
      const { escrow, payer, payee, stranger } = await loadFixture(deployFixture)
      const amount = ethers.parseEther('1')
      const { escrowId } = await createFor(escrow, payer, payee, { amount })
      await expect(
        escrow.connect(stranger).fund(escrowId, { value: amount }),
      ).to.be.revertedWithCustomError(escrow, 'NotPayer')
    })

    it('lets either party cancel before funding', async function () {
      const { escrow, payer, payee } = await loadFixture(deployFixture)
      const a = await createFor(escrow, payer, payee)
      await escrow.connect(payee).cancel(a.escrowId)
      expect(await escrow.stateOf(a.escrowId)).to.equal(State.Cancelled)

      // The client created this one, so the client can withdraw it too.
      const b = await createFor(escrow, payer, payee)
      await escrow.connect(payer).cancel(b.escrowId)
      expect(await escrow.stateOf(b.escrowId)).to.equal(State.Cancelled)
    })

    it('refuses a stranger cancelling before the deadline', async function () {
      const { escrow, payer, payee, stranger } = await loadFixture(deployFixture)
      const { escrowId } = await createFor(escrow, payer, payee)
      await expect(escrow.connect(stranger).cancel(escrowId)).to.be.revertedWithCustomError(escrow, 'NotPayee')
    })
  })
})
