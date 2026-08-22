const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers')
const { State, ReleaseTrigger, HOUR, DAY, usdc, saltFor, createEscrow } = require('./helpers')

describe('VaultedEscrow — lifecycle', function () {
  async function deployFixture() {
    const [deployer, payee, payer, stranger, arbiter, otherPayee] = await ethers.getSigners()

    const token = await (await ethers.getContractFactory('MockUSDC')).deploy(6)
    const escrow = await (
      await ethers.getContractFactory('VaultedEscrow')
    ).deploy(await token.getAddress(), arbiter.address)

    for (const account of [payer, stranger, otherPayee]) {
      await token.mint(account.address, usdc(1_000_000))
      await token.connect(account).approve(await escrow.getAddress(), ethers.MaxUint256)
    }

    return { escrow, token, deployer, payee, payer, stranger, arbiter, otherPayee }
  }

  /** Escrow created for a named payer and funded by them. Returns the id and the funding block time. */
  async function fundedFixture() {
    const base = await loadFixture(deployFixture)
    const { escrow, payee, payer } = base
    const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: usdc(500) })
    const tx = await escrow.connect(payer).fund(escrowId)
    const fundedAt = BigInt((await ethers.provider.getBlock(tx.blockNumber)).timestamp)
    return { ...base, escrowId, fundedAt, expiresAt: fundedAt + BigInt(DAY) }
  }

  // -------------------------------------------------------------------
  describe('deployment', function () {
    it('records the escrow token, its decimals and the arbiter', async function () {
      const { escrow, token, arbiter } = await loadFixture(deployFixture)
      expect(await escrow.token()).to.equal(await token.getAddress())
      expect(await escrow.tokenDecimals()).to.equal(6)
      expect(await escrow.arbiter()).to.equal(arbiter.address)
      expect(await escrow.totalLocked()).to.equal(0)
    })

    it('exposes the 24 hour default protection period and its bounds', async function () {
      const { escrow } = await loadFixture(deployFixture)
      expect(await escrow.DEFAULT_PROTECTION_PERIOD()).to.equal(24 * HOUR)
      expect(await escrow.MIN_PROTECTION_PERIOD()).to.equal(HOUR)
      expect(await escrow.MAX_PROTECTION_PERIOD()).to.equal(365 * DAY)
    })

    it('rejects a zero token address', async function () {
      const { arbiter } = await loadFixture(deployFixture)
      const factory = await ethers.getContractFactory('VaultedEscrow')
      await expect(factory.deploy(ethers.ZeroAddress, arbiter.address)).to.be.revertedWithCustomError(
        factory,
        'ZeroAddress',
      )
    })

    it('falls back to 18 decimals for a token that does not implement decimals()', async function () {
      const { arbiter } = await loadFixture(deployFixture)
      const odd = await (await ethers.getContractFactory('NoDecimalsToken')).deploy()
      const escrow = await (
        await ethers.getContractFactory('VaultedEscrow')
      ).deploy(await odd.getAddress(), arbiter.address)
      expect(await escrow.tokenDecimals()).to.equal(18)
    })

    it('can be deployed with no arbiter at all', async function () {
      const { token } = await loadFixture(deployFixture)
      const escrow = await (
        await ethers.getContractFactory('VaultedEscrow')
      ).deploy(await token.getAddress(), ethers.ZeroAddress)
      expect(await escrow.arbiter()).to.equal(ethers.ZeroAddress)
    })
  })

  // -------------------------------------------------------------------
  describe('createEscrow', function () {
    it('stores the terms and emits EscrowCreated', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const salt = saltFor('inv_001')
      const detailsHash = ethers.keccak256(ethers.toUtf8Bytes('Web3 Growth Campaign'))

      const { escrowId, tx } = await createEscrow(escrow, payee, {
        payer: payer.address,
        amount: usdc(500),
        protectionPeriod: 48 * HOUR,
        detailsHash,
        salt,
      })
      const createdAt = BigInt((await ethers.provider.getBlock(tx.blockNumber)).timestamp)

      await expect(tx)
        .to.emit(escrow, 'EscrowCreated')
        .withArgs(escrowId, payee.address, payer.address, usdc(500), 48 * HOUR, 0, detailsHash, salt, createdAt)

      const e = await escrow.getEscrow(escrowId)
      expect(e.payer).to.equal(payer.address)
      expect(e.payee).to.equal(payee.address)
      expect(e.amount).to.equal(usdc(500))
      expect(e.state).to.equal(State.Created)
      expect(e.createdAt).to.equal(createdAt)
      expect(e.fundedAt).to.equal(0)
      expect(e.expiresAt).to.equal(0)
      expect(e.protectionPeriod).to.equal(48 * HOUR)
      expect(e.detailsHash).to.equal(detailsHash)
    })

    it('applies the 24 hour default when the protection period is zero', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, protectionPeriod: 0 })
      expect((await escrow.getEscrow(escrowId)).protectionPeriod).to.equal(24 * HOUR)
    })

    it('derives an id that the caller can compute before creating', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const salt = saltFor('inv_precomputed')
      const predicted = await escrow.computeEscrowId(payee.address, salt)
      expect(await escrow.stateOf(predicted)).to.equal(State.None)

      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, salt })
      expect(escrowId).to.equal(predicted)
    })

    it('namespaces ids per payee, so two payees may reuse the same salt', async function () {
      const { escrow, payee, otherPayee, payer } = await loadFixture(deployFixture)
      const salt = saltFor('inv_shared')
      const a = await createEscrow(escrow, payee, { payer: payer.address, salt })
      const b = await createEscrow(escrow, otherPayee, { payer: payer.address, salt })
      expect(a.escrowId).to.not.equal(b.escrowId)
      expect(await escrow.stateOf(a.escrowId)).to.equal(State.Created)
      expect(await escrow.stateOf(b.escrowId)).to.equal(State.Created)
    })

    it('rejects a zero amount', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      await expect(
        createEscrow(escrow, payee, { payer: payer.address, amount: 0 }),
      ).to.be.revertedWithCustomError(escrow, 'ZeroAmount')
    })

    it('rejects a payer that is the payee', async function () {
      const { escrow, payee } = await loadFixture(deployFixture)
      await expect(createEscrow(escrow, payee, { payer: payee.address })).to.be.revertedWithCustomError(
        escrow,
        'PayerIsPayee',
      )
    })

    it('rejects the escrow contract itself as the payer', async function () {
      const { escrow, payee } = await loadFixture(deployFixture)
      await expect(
        createEscrow(escrow, payee, { payer: await escrow.getAddress() }),
      ).to.be.revertedWithCustomError(escrow, 'InvalidPayer')
    })

    it('rejects a protection period below the floor', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      await expect(
        createEscrow(escrow, payee, { payer: payer.address, protectionPeriod: HOUR - 1 }),
      )
        .to.be.revertedWithCustomError(escrow, 'ProtectionPeriodOutOfRange')
        .withArgs(HOUR - 1)
    })

    it('rejects a protection period above the ceiling', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      await expect(
        createEscrow(escrow, payee, { payer: payer.address, protectionPeriod: 365 * DAY + 1 }),
      )
        .to.be.revertedWithCustomError(escrow, 'ProtectionPeriodOutOfRange')
        .withArgs(365 * DAY + 1)
    })

    it('accepts exactly the minimum and exactly the maximum protection period', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const min = await createEscrow(escrow, payee, { payer: payer.address, protectionPeriod: HOUR })
      const max = await createEscrow(escrow, payee, { payer: payer.address, protectionPeriod: 365 * DAY })
      expect((await escrow.getEscrow(min.escrowId)).protectionPeriod).to.equal(HOUR)
      expect((await escrow.getEscrow(max.escrowId)).protectionPeriod).to.equal(365 * DAY)
    })

    it('rejects a funding deadline that is already in the past or exactly now', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const now = await time.latest()
      await expect(
        createEscrow(escrow, payee, { payer: payer.address, fundingDeadline: now - 1 }),
      ).to.be.revertedWithCustomError(escrow, 'FundingDeadlineInPast')

      // Pin the next block so the deadline lands on "exactly now" from the contract's point of view.
      const exactlyNow = (await time.latest()) + 5
      await time.setNextBlockTimestamp(exactlyNow)
      await expect(
        createEscrow(escrow, payee, { payer: payer.address, fundingDeadline: exactlyNow }),
      )
        .to.be.revertedWithCustomError(escrow, 'FundingDeadlineInPast')
        .withArgs(exactlyNow)
    })

    it('refuses to reuse a salt the payee already used', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const salt = saltFor('inv_dup')
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, salt })
      await expect(createEscrow(escrow, payee, { payer: payer.address, salt }))
        .to.be.revertedWithCustomError(escrow, 'EscrowAlreadyExists')
        .withArgs(escrowId)
    })

    it('refuses to reuse a salt after the escrow settled — a settled id is never replayable', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const salt = saltFor('inv_settled')
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, salt })
      await escrow.connect(payer).fund(escrowId)
      await escrow.connect(payer).release(escrowId)

      await expect(createEscrow(escrow, payee, { payer: payer.address, salt }))
        .to.be.revertedWithCustomError(escrow, 'EscrowAlreadyExists')
        .withArgs(escrowId)
    })

    it('refuses to reuse a salt after the escrow was cancelled', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const salt = saltFor('inv_cancelled')
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, salt })
      await escrow.connect(payee).cancel(escrowId)
      await expect(createEscrow(escrow, payee, { payer: payer.address, salt }))
        .to.be.revertedWithCustomError(escrow, 'EscrowAlreadyExists')
        .withArgs(escrowId)
    })
  })

  // -------------------------------------------------------------------
  describe('fund', function () {
    it('moves the tokens, locks the escrow and starts the protection window', async function () {
      const { escrow, token, payee, payer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: usdc(500) })

      const tx = await escrow.connect(payer).fund(escrowId)
      const fundedAt = BigInt((await ethers.provider.getBlock(tx.blockNumber)).timestamp)
      const expiresAt = fundedAt + BigInt(DAY)

      await expect(tx)
        .to.emit(escrow, 'EscrowFunded')
        .withArgs(escrowId, payer.address, usdc(500), fundedAt, expiresAt)
      await expect(tx).to.changeTokenBalances(
        token,
        [payer, escrow],
        [-usdc(500), usdc(500)],
      )

      const e = await escrow.getEscrow(escrowId)
      expect(e.state).to.equal(State.Funded)
      expect(e.fundedAt).to.equal(fundedAt)
      expect(e.expiresAt).to.equal(expiresAt)
      expect(await escrow.totalLocked()).to.equal(usdc(500))
    })

    it('lets the first funder of an open link become the payer', async function () {
      const { escrow, payee, stranger } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: ethers.ZeroAddress })
      expect((await escrow.getEscrow(escrowId)).payer).to.equal(ethers.ZeroAddress)

      await escrow.connect(stranger).fund(escrowId)
      expect((await escrow.getEscrow(escrowId)).payer).to.equal(stranger.address)
    })

    it('will not let the payee fund their own open link', async function () {
      const { escrow, token, payee } = await loadFixture(deployFixture)
      await token.mint(payee.address, usdc(1000))
      await token.connect(payee).approve(await escrow.getAddress(), ethers.MaxUint256)
      const { escrowId } = await createEscrow(escrow, payee, { payer: ethers.ZeroAddress })
      await expect(escrow.connect(payee).fund(escrowId)).to.be.revertedWithCustomError(escrow, 'PayerIsPayee')
    })

    it('rejects anyone other than the named payer', async function () {
      const { escrow, payee, payer, stranger } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })
      await expect(escrow.connect(stranger).fund(escrowId))
        .to.be.revertedWithCustomError(escrow, 'NotPayer')
        .withArgs(stranger.address, payer.address)
    })

    it('cannot be funded twice', async function () {
      const { escrowId, escrow, payer } = await loadFixture(fundedFixture)
      await expect(escrow.connect(payer).fund(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Funded)
    })

    it('reverts for an id that was never created', async function () {
      const { escrow, payer } = await loadFixture(deployFixture)
      const unknownId = saltFor('never-created')
      await expect(escrow.connect(payer).fund(unknownId))
        .to.be.revertedWithCustomError(escrow, 'EscrowNotFound')
        .withArgs(unknownId)
    })

    it('cannot fund a cancelled escrow', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })
      await escrow.connect(payee).cancel(escrowId)
      await expect(escrow.connect(payer).fund(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Cancelled)
    })

    it('reverts when the payer has not approved enough', async function () {
      const { escrow, token, payee, payer } = await loadFixture(deployFixture)
      await token.connect(payer).approve(await escrow.getAddress(), usdc(100))
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: usdc(500) })
      await expect(escrow.connect(payer).fund(escrowId)).to.be.revertedWithCustomError(
        token,
        'ERC20InsufficientAllowance',
      )
    })

    it('reverts when the payer does not hold enough', async function () {
      const { escrow, token, payee, stranger } = await loadFixture(deployFixture)
      const balance = await token.balanceOf(stranger.address)
      await token.connect(stranger).transfer(payee.address, balance)
      const { escrowId } = await createEscrow(escrow, payee, { payer: stranger.address, amount: usdc(500) })
      await expect(escrow.connect(stranger).fund(escrowId)).to.be.revertedWithCustomError(
        token,
        'ERC20InsufficientBalance',
      )
    })

    it('accepts funding at exactly the funding deadline and rejects it one second later', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const deadline = (await time.latest()) + DAY

      const onTime = await createEscrow(escrow, payee, { payer: payer.address, fundingDeadline: deadline })
      await time.setNextBlockTimestamp(deadline)
      await escrow.connect(payer).fund(onTime.escrowId)
      expect(await escrow.stateOf(onTime.escrowId)).to.equal(State.Funded)

      const late = await createEscrow(escrow, payee, { payer: payer.address, fundingDeadline: deadline + DAY })
      await time.setNextBlockTimestamp(deadline + DAY + 1)
      await expect(escrow.connect(payer).fund(late.escrowId))
        .to.be.revertedWithCustomError(escrow, 'FundingDeadlinePassed')
        .withArgs(deadline + DAY)
    })
  })

  // -------------------------------------------------------------------
  describe('release', function () {
    it('pays the payee in full and closes the escrow', async function () {
      const { escrow, token, escrowId, payee, payer } = await loadFixture(fundedFixture)

      const tx = await escrow.connect(payer).release(escrowId)
      await expect(tx)
        .to.emit(escrow, 'EscrowReleased')
        .withArgs(escrowId, payee.address, usdc(500), ReleaseTrigger.PayerRelease, payer.address)
      await expect(tx).to.changeTokenBalances(token, [escrow, payee], [-usdc(500), usdc(500)])

      expect(await escrow.stateOf(escrowId)).to.equal(State.Released)
      expect(await escrow.totalLocked()).to.equal(0)
    })

    it('rejects the payee, a stranger and even the arbiter', async function () {
      const { escrow, escrowId, payee, payer, stranger, arbiter } = await loadFixture(fundedFixture)
      for (const caller of [payee, stranger, arbiter]) {
        await expect(escrow.connect(caller).release(escrowId))
          .to.be.revertedWithCustomError(escrow, 'NotPayer')
          .withArgs(caller.address, payer.address)
      }
    })

    it('cannot be released twice', async function () {
      const { escrow, escrowId, payer } = await loadFixture(fundedFixture)
      await escrow.connect(payer).release(escrowId)
      await expect(escrow.connect(payer).release(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Released)
    })

    it('cannot be released before funding', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })
      await expect(escrow.connect(payer).release(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Created)
    })

    it('still works after expiry — the payer may always concede', async function () {
      const { escrow, escrowId, payer, expiresAt } = await loadFixture(fundedFixture)
      await time.increaseTo(expiresAt + 1000n)
      await expect(escrow.connect(payer).release(escrowId)).to.emit(escrow, 'EscrowReleased')
    })

    it('still works while disputed — releasing only gives up the payer’s own claim', async function () {
      const { escrow, escrowId, payer, payee, token } = await loadFixture(fundedFixture)
      await escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)
      await expect(escrow.connect(payer).release(escrowId)).to.changeTokenBalance(token, payee, usdc(500))
      expect(await escrow.stateOf(escrowId)).to.equal(State.Released)
    })

    it('cannot be released after a refund', async function () {
      const { escrow, escrowId, payee, payer } = await loadFixture(fundedFixture)
      await escrow.connect(payee).refund(escrowId)
      await expect(escrow.connect(payer).release(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Refunded)
    })
  })

  // -------------------------------------------------------------------
  describe('executeTimeout', function () {
    it('reverts before expiry, including one second short of it', async function () {
      const { escrow, escrowId, stranger, expiresAt } = await loadFixture(fundedFixture)
      await time.setNextBlockTimestamp(expiresAt - 1n)
      await expect(escrow.connect(stranger).executeTimeout(escrowId))
        .to.be.revertedWithCustomError(escrow, 'NotYetExpired')
        .withArgs(expiresAt)
    })

    it('succeeds at exactly the expiry timestamp', async function () {
      const { escrow, escrowId, stranger, expiresAt } = await loadFixture(fundedFixture)
      await time.setNextBlockTimestamp(expiresAt)
      await expect(escrow.connect(stranger).executeTimeout(escrowId)).to.emit(escrow, 'EscrowReleased')
    })

    it('is permissionless — any address can settle an expired escrow to the payee', async function () {
      for (const role of ['stranger', 'payee', 'payer', 'deployer']) {
        const fixture = await loadFixture(fundedFixture)
        const { escrow, token, escrowId, payee, expiresAt } = fixture
        await time.increaseTo(expiresAt)

        const tx = await escrow.connect(fixture[role]).executeTimeout(escrowId)
        await expect(tx)
          .to.emit(escrow, 'EscrowReleased')
          .withArgs(escrowId, payee.address, usdc(500), ReleaseTrigger.Timeout, fixture[role].address)
        await expect(tx).to.changeTokenBalance(token, payee, usdc(500))
      }
    })

    it('cannot be executed twice', async function () {
      const { escrow, escrowId, stranger, expiresAt } = await loadFixture(fundedFixture)
      await time.increaseTo(expiresAt)
      await escrow.connect(stranger).executeTimeout(escrowId)
      await expect(escrow.connect(stranger).executeTimeout(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Released)
    })

    it('cannot be executed after the payer already released', async function () {
      const { escrow, escrowId, payer, stranger, expiresAt } = await loadFixture(fundedFixture)
      await escrow.connect(payer).release(escrowId)
      await time.increaseTo(expiresAt)
      await expect(escrow.connect(stranger).executeTimeout(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Released)
    })

    it('is blocked by an open dispute even long after expiry', async function () {
      const { escrow, escrowId, payer, stranger, expiresAt } = await loadFixture(fundedFixture)
      await escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)
      await time.increaseTo(expiresAt + BigInt(30 * DAY))
      await expect(escrow.connect(stranger).executeTimeout(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Disputed)
    })

    it('cannot be executed on an unfunded escrow', async function () {
      const { escrow, payee, payer, stranger } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })
      await time.increase(30 * DAY)
      await expect(escrow.connect(stranger).executeTimeout(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Created)
    })

    it('reverts for an unknown escrow id', async function () {
      const { escrow, stranger } = await loadFixture(deployFixture)
      const unknownId = saltFor('nope')
      await expect(escrow.connect(stranger).executeTimeout(unknownId))
        .to.be.revertedWithCustomError(escrow, 'EscrowNotFound')
        .withArgs(unknownId)
    })
  })

  // -------------------------------------------------------------------
  describe('dispute', function () {
    it('locks the escrow and records the evidence commitment', async function () {
      const { escrow, escrowId, payer } = await loadFixture(fundedFixture)
      const evidence = ethers.keccak256(ethers.toUtf8Bytes('ipfs://evidence'))

      const tx = await escrow.connect(payer).dispute(escrowId, evidence)
      const disputedAt = BigInt((await ethers.provider.getBlock(tx.blockNumber)).timestamp)
      await expect(tx).to.emit(escrow, 'EscrowDisputed').withArgs(escrowId, payer.address, disputedAt, evidence)
      expect(await escrow.stateOf(escrowId)).to.equal(State.Disputed)
    })

    it('keeps the funds in the contract', async function () {
      const { escrow, token, escrowId, payer } = await loadFixture(fundedFixture)
      await expect(escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)).to.changeTokenBalance(token, escrow, 0)
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(usdc(500))
      expect(await escrow.totalLocked()).to.equal(usdc(500))
    })

    it('rejects everyone except the payer', async function () {
      const { escrow, escrowId, payee, stranger, arbiter, payer } = await loadFixture(fundedFixture)
      for (const caller of [payee, stranger, arbiter]) {
        await expect(escrow.connect(caller).dispute(escrowId, ethers.ZeroHash))
          .to.be.revertedWithCustomError(escrow, 'NotPayer')
          .withArgs(caller.address, payer.address)
      }
    })

    it('cannot be raised before funding', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })
      await expect(escrow.connect(payer).dispute(escrowId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Created)
    })

    it('is allowed one second before expiry and refused at exactly expiry', async function () {
      const early = await loadFixture(fundedFixture)
      await time.setNextBlockTimestamp(early.expiresAt - 1n)
      await expect(early.escrow.connect(early.payer).dispute(early.escrowId, ethers.ZeroHash)).to.emit(
        early.escrow,
        'EscrowDisputed',
      )

      const late = await loadFixture(fundedFixture)
      await time.setNextBlockTimestamp(late.expiresAt)
      await expect(late.escrow.connect(late.payer).dispute(late.escrowId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(late.escrow, 'ProtectionWindowClosed')
        .withArgs(late.expiresAt)
    })

    it('cannot be raised twice', async function () {
      const { escrow, escrowId, payer } = await loadFixture(fundedFixture)
      await escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)
      await expect(escrow.connect(payer).dispute(escrowId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Disputed)
    })

    it('leaves the payee with no way to withdraw unilaterally', async function () {
      const { escrow, escrowId, payee, payer, stranger, expiresAt } = await loadFixture(fundedFixture)
      await escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)
      await time.increaseTo(expiresAt + BigInt(DAY))

      await expect(escrow.connect(payee).release(escrowId)).to.be.revertedWithCustomError(escrow, 'NotPayer')
      await expect(escrow.connect(payee).executeTimeout(escrowId)).to.be.revertedWithCustomError(
        escrow,
        'InvalidState',
      )
      await expect(escrow.connect(stranger).executeTimeout(escrowId)).to.be.revertedWithCustomError(
        escrow,
        'InvalidState',
      )
      expect(await escrow.totalLocked()).to.equal(usdc(500))
    })
  })

  // -------------------------------------------------------------------
  describe('refund', function () {
    it('returns the funds to the payer when the payee concedes', async function () {
      const { escrow, token, escrowId, payee, payer } = await loadFixture(fundedFixture)
      const tx = await escrow.connect(payee).refund(escrowId)
      await expect(tx).to.emit(escrow, 'EscrowRefunded').withArgs(escrowId, payer.address, usdc(500), payee.address)
      await expect(tx).to.changeTokenBalances(token, [escrow, payer], [-usdc(500), usdc(500)])
      expect(await escrow.stateOf(escrowId)).to.equal(State.Refunded)
      expect(await escrow.totalLocked()).to.equal(0)
    })

    it('works while disputed, giving the payee an exit that does not need the arbiter', async function () {
      const { escrow, token, escrowId, payee, payer } = await loadFixture(fundedFixture)
      await escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)
      await expect(escrow.connect(payee).refund(escrowId)).to.changeTokenBalance(token, payer, usdc(500))
      expect(await escrow.stateOf(escrowId)).to.equal(State.Refunded)
    })

    it('rejects everyone except the payee', async function () {
      const { escrow, escrowId, payee, payer, stranger, arbiter } = await loadFixture(fundedFixture)
      for (const caller of [payer, stranger, arbiter]) {
        await expect(escrow.connect(caller).refund(escrowId))
          .to.be.revertedWithCustomError(escrow, 'NotPayee')
          .withArgs(caller.address, payee.address)
      }
    })

    it('cannot be refunded twice', async function () {
      const { escrow, escrowId, payee } = await loadFixture(fundedFixture)
      await escrow.connect(payee).refund(escrowId)
      await expect(escrow.connect(payee).refund(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Refunded)
    })

    it('cannot be refunded after release', async function () {
      const { escrow, escrowId, payee, payer } = await loadFixture(fundedFixture)
      await escrow.connect(payer).release(escrowId)
      await expect(escrow.connect(payee).refund(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Released)
    })
  })

  // -------------------------------------------------------------------
  describe('cancel', function () {
    it('lets the payee withdraw an unfunded link', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })
      await expect(escrow.connect(payee).cancel(escrowId))
        .to.emit(escrow, 'EscrowCancelled')
        .withArgs(escrowId, payee.address)
      expect(await escrow.stateOf(escrowId)).to.equal(State.Cancelled)
    })

    it('refuses a stranger while the funding deadline is still open', async function () {
      const { escrow, payee, payer, stranger } = await loadFixture(deployFixture)
      const deadline = (await time.latest()) + DAY
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, fundingDeadline: deadline })
      await expect(escrow.connect(stranger).cancel(escrowId))
        .to.be.revertedWithCustomError(escrow, 'NotPayee')
        .withArgs(stranger.address, payee.address)
    })

    it('refuses a stranger forever when the link has no funding deadline', async function () {
      const { escrow, payee, payer, stranger } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, fundingDeadline: 0 })
      await time.increase(1000 * DAY)
      await expect(escrow.connect(stranger).cancel(escrowId)).to.be.revertedWithCustomError(escrow, 'NotPayee')
    })

    it('opens up to anyone once the funding deadline has passed', async function () {
      const { escrow, payee, payer, stranger } = await loadFixture(deployFixture)
      const deadline = (await time.latest()) + DAY
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, fundingDeadline: deadline })
      await time.setNextBlockTimestamp(deadline + 1)
      await expect(escrow.connect(stranger).cancel(escrowId))
        .to.emit(escrow, 'EscrowCancelled')
        .withArgs(escrowId, stranger.address)
    })

    it('cannot cancel a funded escrow', async function () {
      const { escrow, escrowId, payee } = await loadFixture(fundedFixture)
      await expect(escrow.connect(payee).cancel(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Funded)
    })

    it('cannot cancel twice', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })
      await escrow.connect(payee).cancel(escrowId)
      await expect(escrow.connect(payee).cancel(escrowId))
        .to.be.revertedWithCustomError(escrow, 'InvalidState')
        .withArgs(escrowId, State.Cancelled)
    })
  })

  // -------------------------------------------------------------------
  describe('views', function () {
    it('tracks the derived timing flags across the whole lifecycle', async function () {
      const { escrow, payee, payer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address })

      let v = await escrow.getEscrowView(escrowId)
      expect(v.exists).to.equal(true)
      expect(v.isExpired).to.equal(false)
      expect(v.canTimeout).to.equal(false)
      expect(v.canDispute).to.equal(false)

      await escrow.connect(payer).fund(escrowId)
      v = await escrow.getEscrowView(escrowId)
      expect(v.canDispute).to.equal(true)
      expect(v.canTimeout).to.equal(false)
      expect(v.secondsUntilExpiry).to.be.greaterThan(0n)
      expect(v.secondsUntilExpiry).to.be.lessThanOrEqual(BigInt(DAY))

      await time.increaseTo(v.escrow.expiresAt)
      v = await escrow.getEscrowView(escrowId)
      expect(v.isExpired).to.equal(true)
      expect(v.canTimeout).to.equal(true)
      expect(v.canDispute).to.equal(false)
      expect(v.secondsUntilExpiry).to.equal(0n)

      await escrow.executeTimeout(escrowId)
      v = await escrow.getEscrowView(escrowId)
      expect(v.escrow.state).to.equal(State.Released)
      expect(v.isExpired).to.equal(false)
      expect(v.canTimeout).to.equal(false)
    })

    it('reports a disputed escrow as neither timeout-able nor disputable', async function () {
      const { escrow, escrowId, payer, expiresAt } = await loadFixture(fundedFixture)
      await escrow.connect(payer).dispute(escrowId, ethers.ZeroHash)
      await time.increaseTo(expiresAt + 1n)
      const v = await escrow.getEscrowView(escrowId)
      expect(v.escrow.state).to.equal(State.Disputed)
      expect(v.canTimeout).to.equal(false)
      expect(v.canDispute).to.equal(false)
    })

    it('returns an empty view for an unknown id instead of reverting', async function () {
      const { escrow } = await loadFixture(deployFixture)
      const v = await escrow.getEscrowView(saltFor('unknown'))
      expect(v.exists).to.equal(false)
      expect(v.escrow.state).to.equal(State.None)
    })

    it('getEscrow reverts for an unknown id', async function () {
      const { escrow } = await loadFixture(deployFixture)
      const unknownId = saltFor('unknown')
      await expect(escrow.getEscrow(unknownId)).to.be.revertedWithCustomError(escrow, 'EscrowNotFound').withArgs(unknownId)
    })
  })

  // -------------------------------------------------------------------
  describe('amount edge cases', function () {
    it('handles the smallest possible amount', async function () {
      const { escrow, token, payee, payer } = await loadFixture(deployFixture)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: 1 })
      await escrow.connect(payer).fund(escrowId)
      await expect(escrow.connect(payer).release(escrowId)).to.changeTokenBalance(token, payee, 1)
    })

    it('handles an amount at the uint96 ceiling', async function () {
      const { escrow, token, payee, payer } = await loadFixture(deployFixture)
      const max = 2n ** 96n - 1n
      await token.mint(payer.address, max)
      const { escrowId } = await createEscrow(escrow, payee, { payer: payer.address, amount: max })
      await escrow.connect(payer).fund(escrowId)
      expect(await escrow.totalLocked()).to.equal(max)
      await expect(escrow.connect(payer).release(escrowId)).to.changeTokenBalance(token, payee, max)
    })
  })
})
