const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers')
const { State, DAY, usdc, saltFor, createEscrow } = require('./helpers')

describe('VaultedEscrow — arbitration, hostile tokens and invariants', function () {
  async function deployFixture() {
    const [deployer, payee, payer, stranger, arbiter, newArbiter] = await ethers.getSigners()
    const token = await (await ethers.getContractFactory('MockUSDC')).deploy(6)
    const escrow = await (
      await ethers.getContractFactory('VaultedEscrow')
    ).deploy(await token.getAddress(), arbiter.address)

    for (const account of [payer, stranger, deployer]) {
      await token.mint(account.address, usdc(1_000_000))
      await token.connect(account).approve(await escrow.getAddress(), ethers.MaxUint256)
    }
    return { escrow, token, deployer, payee, payer, stranger, arbiter, newArbiter }
  }

  async function disputedFixture() {
    const base = await loadFixture(deployFixture)
    const { escrow, payee, payer } = base
    const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: usdc(500) })
    await escrow.connect(payer).fund(escrowId)
    await escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)
    return { ...base, escrowId }
  }

  // -------------------------------------------------------------------
  describe('resolveDispute (trusted arbiter)', function () {
    it('splits the escrow between payee and payer', async function () {
      const { escrow, token, escrowId, arbiter, payee, payer } = await loadFixture(disputedFixture)
      const ruling = ethers.keccak256(ethers.toUtf8Bytes('ipfs://ruling'))

      const tx = await escrow.connect(arbiter).resolveDispute(escrowId, usdc(300), ruling)
      await expect(tx)
        .to.emit(escrow, 'DisputeResolved')
        .withArgs(escrowId, arbiter.address, usdc(300), usdc(200), ruling)
      await expect(tx).to.changeTokenBalances(
        token,
        [escrow, payee, payer, arbiter],
        [-usdc(500), usdc(300), usdc(200), 0],
      )

      expect(await escrow.stateOf(escrowId)).to.equal(State.Resolved)
      expect(await escrow.totalLocked()).to.equal(0)
    })

    it('can award the whole amount to either side', async function () {
      const all = await loadFixture(disputedFixture)
      await expect(
        all.escrow.connect(all.arbiter).resolveDispute(all.escrowId, usdc(500), ethers.ZeroHash),
      ).to.changeTokenBalances(all.token, [all.payee, all.payer], [usdc(500), 0])

      const none = await loadFixture(disputedFixture)
      await expect(
        none.escrow.connect(none.arbiter).resolveDispute(none.escrowId, 0, ethers.ZeroHash),
      ).to.changeTokenBalances(none.token, [none.payee, none.payer], [0, usdc(500)])
    })

    it('cannot award more than the escrow holds', async function () {
      const { escrow, escrowId, arbiter } = await loadFixture(disputedFixture)
      await expect(escrow.connect(arbiter).resolveDispute(escrowId, usdc(501), ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'AmountExceedsEscrow')
        .withArgs(usdc(501), usdc(500))
    })

    it('rejects everyone except the arbiter', async function () {
      const { escrow, escrowId, payee, payer, stranger, arbiter } = await loadFixture(disputedFixture)
      for (const caller of [payee, payer, stranger]) {
        await expect(escrow.connect(caller).resolveDispute(escrowId, usdc(500), ethers.ZeroHash))
          .to.be.revertedWithCustomError(escrow, 'NotArbiter')
          .withArgs(caller.address, arbiter.address)
      }
    })

    it('cannot touch an escrow that is not disputed', async function () {
      const { escrow, payee, payer, arbiter } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })
      await expect(escrow.connect(arbiter).resolveDispute(escrowId, 1, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Created)

      await escrow.connect(payer).fund(escrowId)
      await expect(escrow.connect(arbiter).resolveDispute(escrowId, 1, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Funded)
    })

    it('cannot resolve the same dispute twice', async function () {
      const { escrow, escrowId, arbiter } = await loadFixture(disputedFixture)
      await escrow.connect(arbiter).resolveDispute(escrowId, usdc(250), ethers.ZeroHash)
      await expect(escrow.connect(arbiter).resolveDispute(escrowId, usdc(250), ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Resolved)
    })

    it('is unavailable on a deployment configured with no arbiter', async function () {
      const { token, payee, payer } = await loadFixture(deployFixture)
      const escrow = await (
        await ethers.getContractFactory('VaultedEscrow')
      ).deploy(await token.getAddress(), ethers.ZeroAddress)
      await token.connect(payer).approve(await escrow.getAddress(), ethers.MaxUint256)

      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })
      await escrow.connect(payer).fund(escrowId)
      await escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)

      await expect(escrow.connect(payer).resolveDispute(escrowId, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(
        escrow,
        'ArbitrationUnavailable',
      )
      // The documented escape hatch: either side may still concede.
      await expect(escrow.connect(payee).refund(escrowId)).to.emit(escrow, 'EscrowRefunded')
    })

    it('becomes unavailable after the arbiter renounces, leaving concession as the only exit', async function () {
      const { escrow, escrowId, arbiter, payer, payee, token } = await loadFixture(disputedFixture)
      await escrow.connect(arbiter).renounceArbiter()

      await expect(
        escrow.connect(arbiter).resolveDispute(escrowId, usdc(500), ethers.ZeroHash),
      ).to.be.revertedWithCustomError(escrow, 'ArbitrationUnavailable')
      expect(await escrow.stateOf(escrowId)).to.equal(State.Disputed)

      await expect(escrow.connect(payer).release(escrowId)).to.changeTokenBalance(token, payee, usdc(500))
    })

    it('leaves an unresolved dispute locked — there is no automatic fallback', async function () {
      const { escrow, escrowId, stranger, payee } = await loadFixture(disputedFixture)
      await time.increase(365 * DAY)
      await expect(escrow.connect(stranger).executeTimeout(escrowId)).to.be.revertedWithCustomError(
        escrow,
        'InvalidState',
      )
      await expect(escrow.connect(payee).release(escrowId)).to.be.revertedWithCustomError(escrow, 'NotPayer')
      expect(await escrow.totalLocked()).to.equal(usdc(500))
    })
  })

  // -------------------------------------------------------------------
  describe('arbiter administration', function () {
    it('transfers in two steps', async function () {
      const { escrow, arbiter, newArbiter } = await loadFixture(deployFixture)

      await expect(escrow.connect(arbiter).transferArbiter(newArbiter.address))
        .to.emit(escrow, 'ArbiterTransferStarted')
        .withArgs(arbiter.address, newArbiter.address)
      expect(await escrow.arbiter()).to.equal(arbiter.address)
      expect(await escrow.pendingArbiter()).to.equal(newArbiter.address)

      await expect(escrow.connect(newArbiter).acceptArbiter())
        .to.emit(escrow, 'ArbiterTransferred')
        .withArgs(arbiter.address, newArbiter.address)
      expect(await escrow.arbiter()).to.equal(newArbiter.address)
      expect(await escrow.pendingArbiter()).to.equal(ethers.ZeroAddress)
    })

    it('rejects a nomination from anyone but the arbiter', async function () {
      const { escrow, stranger, arbiter, newArbiter } = await loadFixture(deployFixture)
      await expect(escrow.connect(stranger).transferArbiter(newArbiter.address))
        .to.be.revertedWithCustomError(escrow, 'NotArbiter')
        .withArgs(stranger.address, arbiter.address)
    })

    it('rejects a nomination of the zero address', async function () {
      const { escrow, arbiter } = await loadFixture(deployFixture)
      await expect(escrow.connect(arbiter).transferArbiter(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        escrow,
        'ZeroAddress',
      )
    })

    it('only the nominee can accept', async function () {
      const { escrow, arbiter, newArbiter, stranger } = await loadFixture(deployFixture)
      await escrow.connect(arbiter).transferArbiter(newArbiter.address)
      await expect(escrow.connect(stranger).acceptArbiter())
        .to.be.revertedWithCustomError(escrow, 'NotPendingArbiter')
        .withArgs(stranger.address, newArbiter.address)
    })

    it('strips the old arbiter of its power once the handover completes', async function () {
      const base = await loadFixture(disputedFixture)
      const { escrow, escrowId, arbiter, newArbiter } = base
      await escrow.connect(arbiter).transferArbiter(newArbiter.address)
      await escrow.connect(newArbiter).acceptArbiter()

      await expect(escrow.connect(arbiter).resolveDispute(escrowId, usdc(500), ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'NotArbiter')
        .withArgs(arbiter.address, newArbiter.address)
      await expect(escrow.connect(newArbiter).resolveDispute(escrowId, usdc(500), ethers.ZeroHash)).to.emit(
        escrow,
        'DisputeResolved',
      )
    })

    it('clears a pending nomination on renounce', async function () {
      const { escrow, arbiter, newArbiter } = await loadFixture(deployFixture)
      await escrow.connect(arbiter).transferArbiter(newArbiter.address)
      await expect(escrow.connect(arbiter).renounceArbiter())
        .to.emit(escrow, 'ArbiterTransferred')
        .withArgs(arbiter.address, ethers.ZeroAddress)
      expect(await escrow.arbiter()).to.equal(ethers.ZeroAddress)
      expect(await escrow.pendingArbiter()).to.equal(ethers.ZeroAddress)
      await expect(escrow.connect(newArbiter).acceptArbiter()).to.be.revertedWithCustomError(
        escrow,
        'NotPendingArbiter',
      )
    })
  })

  // -------------------------------------------------------------------
  describe('rescue is bounded by the locked total', function () {
    it('sweeps only the surplus and never the escrowed funds', async function () {
      const { escrow, token, payee, payer, arbiter, stranger, deployer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: usdc(500) })
      await escrow.connect(payer).fund(escrowId)

      // Somebody transfers straight to the contract, bypassing fund().
      await token.connect(stranger).transfer(await escrow.getAddress(), usdc(90))

      const tx = await escrow.connect(arbiter).rescue(await token.getAddress(), deployer.address)
      await expect(tx).to.changeTokenBalances(token, [escrow, deployer], [-usdc(90), usdc(90)])
      await expect(tx).to.emit(escrow, 'Rescued').withArgs(await token.getAddress(), deployer.address, usdc(90))

      // The escrow is untouched and still settles in full.
      expect(await escrow.totalLocked()).to.equal(usdc(500))
      await expect(escrow.connect(payer).release(escrowId)).to.changeTokenBalance(token, payee, usdc(500))
    })

    it('reverts when there is no surplus, even with funds locked', async function () {
      const { escrow, token, payee, payer, arbiter, deployer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: usdc(500) })
      await escrow.connect(payer).fund(escrowId)
      await expect(
        escrow.connect(arbiter).rescue(await token.getAddress(), deployer.address),
      ).to.be.revertedWithCustomError(escrow, 'NothingToRescue')
    })

    it('recovers the full balance of an unrelated token', async function () {
      const { escrow, arbiter, deployer } = await loadFixture(deployFixture)
      const other = await (await ethers.getContractFactory('MockUSDC')).deploy(18)
      await other.mint(await escrow.getAddress(), usdc(42))
      await expect(
        escrow.connect(arbiter).rescue(await other.getAddress(), deployer.address),
      ).to.changeTokenBalances(other, [escrow, deployer], [-usdc(42), usdc(42)])
    })

    it('rejects a non-arbiter caller and a zero destination', async function () {
      const { escrow, token, arbiter, stranger, deployer } = await loadFixture(deployFixture)
      await token.connect(stranger).transfer(await escrow.getAddress(), usdc(10))
      await expect(escrow.connect(stranger).rescue(await token.getAddress(), deployer.address))
        .to.be.revertedWithCustomError(escrow, 'NotArbiter')
        .withArgs(stranger.address, arbiter.address)
      await expect(
        escrow.connect(arbiter).rescue(await token.getAddress(), ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(escrow, 'ZeroAddress')
    })
  })

  // -------------------------------------------------------------------
  describe('reentrancy', function () {
    async function reentrancyFixture() {
      const [deployer, payer, arbiter, stranger] = await ethers.getSigners()
      const token = await (await ethers.getContractFactory('ReentrantToken')).deploy()
      const escrow = await (
        await ethers.getContractFactory('VaultedEscrow')
      ).deploy(await token.getAddress(), arbiter.address)
      const attacker = await (
        await ethers.getContractFactory('ReentrancyAttacker')
      ).deploy(await escrow.getAddress(), await token.getAddress())

      await token.setAttacker(await attacker.getAddress())
      await token.mint(payer.address, ethers.parseEther('1000'))
      await token.connect(payer).approve(await escrow.getAddress(), ethers.MaxUint256)

      return { token, escrow, attacker, deployer, payer, arbiter, stranger }
    }

    const AMOUNT = ethers.parseEther('100')
    const Attack = { None: 0, Release: 1, ExecuteTimeout: 2, Refund: 3, Fund: 4 }

    it('blocks re-entering release from inside the payout transfer', async function () {
      const { token, escrow, attacker, payer } = await loadFixture(reentrancyFixture)
      const escrowId = await escrow.computeEscrowId(await attacker.getAddress(), saltFor('re-release'))
      await attacker.createEscrow(payer.address, AMOUNT, 0, 0, saltFor('re-release'))
      await escrow.connect(payer).fund(escrowId)

      await attacker.arm(Attack.Release, escrowId)
      await token.setHookEnabled(true)
      await escrow.connect(payer).release(escrowId)

      expect(await attacker.attempts()).to.be.greaterThan(0n)
      expect(await attacker.successes()).to.equal(0n)
      expect(await token.balanceOf(await attacker.getAddress())).to.equal(AMOUNT)
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0)
      expect(await escrow.totalLocked()).to.equal(0)
      expect(await escrow.stateOf(escrowId)).to.equal(State.Released)
    })

    it('blocks re-entering executeTimeout from inside the payout transfer', async function () {
      const { token, escrow, attacker, payer, stranger } = await loadFixture(reentrancyFixture)
      const escrowId = await escrow.computeEscrowId(await attacker.getAddress(), saltFor('re-timeout'))
      await attacker.createEscrow(payer.address, AMOUNT, 0, 0, saltFor('re-timeout'))
      await escrow.connect(payer).fund(escrowId)
      await time.increase(DAY + 1)

      await attacker.arm(Attack.ExecuteTimeout, escrowId)
      await token.setHookEnabled(true)
      await escrow.connect(stranger).executeTimeout(escrowId)

      expect(await attacker.attempts()).to.be.greaterThan(0n)
      expect(await attacker.successes()).to.equal(0n)
      expect(await token.balanceOf(await attacker.getAddress())).to.equal(AMOUNT)
      expect(await escrow.totalLocked()).to.equal(0)
    })

    it('blocks re-entering fund from inside the funding transfer', async function () {
      const { token, escrow, attacker, payer } = await loadFixture(reentrancyFixture)
      const escrowId = await escrow.computeEscrowId(await attacker.getAddress(), saltFor('re-fund'))
      await attacker.createEscrow(payer.address, AMOUNT, 0, 0, saltFor('re-fund'))

      await attacker.arm(Attack.Fund, escrowId)
      await token.setHookEnabled(true)
      await escrow.connect(payer).fund(escrowId)

      expect(await attacker.attempts()).to.be.greaterThan(0n)
      expect(await attacker.successes()).to.equal(0n)
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT)
      expect(await escrow.totalLocked()).to.equal(AMOUNT)
    })

    it('blocks cross-escrow reentrancy — draining a second escrow mid-payout fails', async function () {
      const { token, escrow, attacker, payer } = await loadFixture(reentrancyFixture)
      const victimId = await escrow.computeEscrowId(await attacker.getAddress(), saltFor('victim'))
      await attacker.createEscrow(payer.address, AMOUNT, 0, 0, saltFor('victim'))
      await escrow.connect(payer).fund(victimId)

      const bait = await escrow.computeEscrowId(await attacker.getAddress(), saltFor('bait'))
      await attacker.createEscrow(payer.address, AMOUNT, 0, 0, saltFor('bait'))
      await escrow.connect(payer).fund(bait)
      await time.increase(DAY + 1)

      // While `bait` pays out, try to also settle the untouched `victim` escrow.
      await attacker.arm(Attack.ExecuteTimeout, victimId)
      await token.setHookEnabled(true)
      await escrow.connect(payer).executeTimeout(bait)

      expect(await attacker.successes()).to.equal(0n)
      expect(await escrow.stateOf(victimId)).to.equal(State.Funded)
      expect(await escrow.totalLocked()).to.equal(AMOUNT)
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT)
      expect(await token.balanceOf(await attacker.getAddress())).to.equal(AMOUNT)
    })

    it('reverts the nested call with the reentrancy guard error', async function () {
      const { token, escrow, attacker, payer } = await loadFixture(reentrancyFixture)
      const escrowId = await escrow.computeEscrowId(await attacker.getAddress(), saltFor('re-selector'))
      await attacker.createEscrow(payer.address, AMOUNT, 0, 0, saltFor('re-selector'))
      await escrow.connect(payer).fund(escrowId)

      await attacker.arm(Attack.Release, escrowId)
      await token.setHookEnabled(true)
      await escrow.connect(payer).release(escrowId)

      const guardSelector = ethers.id('ReentrancyGuardReentrantCall()').slice(0, 10)
      expect(await attacker.lastRevertData()).to.equal(guardSelector)
    })
  })

  // -------------------------------------------------------------------
  describe('non-standard and failing tokens', function () {
    async function escrowFor(tokenContract, arbiter) {
      return (await ethers.getContractFactory('VaultedEscrow')).deploy(await tokenContract.getAddress(), arbiter)
    }

    it('rejects funding with a token that skims a transfer fee', async function () {
      const { payee, payer, arbiter } = await loadFixture(deployFixture)
      const fot = await (await ethers.getContractFactory('FeeOnTransferToken')).deploy(100) // 1%
      const escrow = await escrowFor(fot, arbiter.address)
      await fot.mint(payer.address, ethers.parseEther('1000'))
      await fot.connect(payer).approve(await escrow.getAddress(), ethers.MaxUint256)

      const amount = ethers.parseEther('100')
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount })
      await expect(escrow.connect(payer).fund(escrowId))
        .to.be.revertedWithCustomError(escrow, 'UnexpectedAmountReceived')
        .withArgs(amount, (amount * 99n) / 100n)
      expect(await escrow.stateOf(escrowId)).to.equal(State.Created)
      expect(await escrow.totalLocked()).to.equal(0)
    })

    it('reverts funding when transferFrom reports failure by returning false', async function () {
      const { payee, payer, arbiter } = await loadFixture(deployFixture)
      const bad = await (await ethers.getContractFactory('FalseReturningToken')).deploy()
      const escrow = await escrowFor(bad, arbiter.address)
      await bad.mint(payer.address, ethers.parseEther('1000'))
      await bad.connect(payer).approve(await escrow.getAddress(), ethers.MaxUint256)
      await bad.setFailures(false, true)

      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: 1000n })
      await expect(escrow.connect(payer).fund(escrowId)).to.be.revertedWithCustomError(
        escrow,
        'SafeERC20FailedOperation',
      )
      expect(await escrow.stateOf(escrowId)).to.equal(State.Created)
    })

    it('reverts the payout when transfer returns false, leaving the escrow intact and retryable', async function () {
      const { payee, payer, arbiter } = await loadFixture(deployFixture)
      const bad = await (await ethers.getContractFactory('FalseReturningToken')).deploy()
      const escrow = await escrowFor(bad, arbiter.address)
      await bad.mint(payer.address, ethers.parseEther('1000'))
      await bad.connect(payer).approve(await escrow.getAddress(), ethers.MaxUint256)

      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: 1000n })
      await escrow.connect(payer).fund(escrowId)

      await bad.setFailures(true, false)
      await expect(escrow.connect(payer).release(escrowId)).to.be.revertedWithCustomError(
        escrow,
        'SafeERC20FailedOperation',
      )
      // Nothing moved and nothing was consumed: state and accounting are exactly as before.
      expect(await escrow.stateOf(escrowId)).to.equal(State.Funded)
      expect(await escrow.totalLocked()).to.equal(1000n)

      await bad.setFailures(false, false)
      await escrow.connect(payer).release(escrowId)
      expect(await bad.balanceOf(payee.address)).to.equal(1000n)
    })

    it('propagates a hard revert from a paused or blocklisting token', async function () {
      const { payee, payer, arbiter } = await loadFixture(deployFixture)
      const rev = await (await ethers.getContractFactory('RevertingToken')).deploy()
      const escrow = await escrowFor(rev, arbiter.address)
      await rev.mint(payer.address, ethers.parseEther('1000'))
      await rev.connect(payer).approve(await escrow.getAddress(), ethers.MaxUint256)

      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: 1000n })
      await escrow.connect(payer).fund(escrowId)

      await rev.setReverts(true, false)
      await expect(escrow.connect(payer).release(escrowId)).to.be.revertedWith('RevertingToken: transfer blocked')
      expect(await escrow.stateOf(escrowId)).to.equal(State.Funded)
    })

    it('works end to end with a USDT-style token that returns no value', async function () {
      const { payee, payer, arbiter } = await loadFixture(deployFixture)
      const noret = await (await ethers.getContractFactory('NoReturnValueToken')).deploy()
      const escrow = await escrowFor(noret, arbiter.address)
      await noret.mint(payer.address, usdc(1000))
      await noret.connect(payer).approve(await escrow.getAddress(), usdc(1000))

      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: usdc(500) })
      await escrow.connect(payer).fund(escrowId)
      expect(await noret.balanceOf(await escrow.getAddress())).to.equal(usdc(500))

      await time.increase(DAY + 1)
      await escrow.executeTimeout(escrowId)
      expect(await noret.balanceOf(payee.address)).to.equal(usdc(500))
    })
  })

  // -------------------------------------------------------------------
  describe('accounting invariants across many escrows', function () {
    it('keeps the contract balance equal to totalLocked through every transition', async function () {
      const { escrow, token, deployer, payee, payer, stranger, arbiter } = await loadFixture(deployFixture)
      const escrowAddress = await escrow.getAddress()
      const assertInvariant = async () =>
        expect(await token.balanceOf(escrowAddress)).to.equal(await escrow.totalLocked())

      const a = await createEscrow(escrow, payee, { payer: payer.address, amount: usdc(100), salt: saltFor('a') })
      const b = await createEscrow(escrow, payee, { payer: stranger.address, amount: usdc(250), salt: saltFor('b') })
      const c = await createEscrow(escrow, payee, { payer: deployer.address, amount: usdc(75), salt: saltFor('c') })

      await escrow.connect(payer).fund(a.escrowId)
      await assertInvariant()
      await escrow.connect(stranger).fund(b.escrowId)
      await assertInvariant()
      await escrow.connect(deployer).fund(c.escrowId)
      await assertInvariant()
      expect(await escrow.totalLocked()).to.equal(usdc(425))

      await escrow.connect(payer).release(a.escrowId)
      await assertInvariant()

      await escrow.connect(stranger).dispute(b.escrowId, ethers.ZeroHash)
      await assertInvariant()
      await escrow.connect(arbiter).resolveDispute(b.escrowId, usdc(150), ethers.ZeroHash)
      await assertInvariant()

      await time.increase(DAY + 1)
      await escrow.executeTimeout(c.escrowId)
      await assertInvariant()

      expect(await escrow.totalLocked()).to.equal(0)
      expect(await token.balanceOf(escrowAddress)).to.equal(0)
    })

    it('settling one escrow cannot reach into another escrow’s funds', async function () {
      const { escrow, token, payee, payer, stranger } = await loadFixture(deployFixture)
      const mine = await createEscrow(escrow, payee, { payer: payer.address, amount: usdc(100), salt: saltFor('m') })
      const theirs = await createEscrow(escrow, payee, {
        payer: stranger.address,
        amount: usdc(900),
        salt: saltFor('t'),
      })
      await escrow.connect(payer).fund(mine.escrowId)
      await escrow.connect(stranger).fund(theirs.escrowId)

      await expect(escrow.connect(payer).release(mine.escrowId)).to.changeTokenBalance(token, payee, usdc(100))
      expect(await escrow.totalLocked()).to.equal(usdc(900))
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(usdc(900))
      expect(await escrow.stateOf(theirs.escrowId)).to.equal(State.Funded)
    })
  })
})
