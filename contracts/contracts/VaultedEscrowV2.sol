// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VaultedEscrowV2
 * @notice Trustless escrow for freelance work, in the chain's native currency or one ERC-20.
 *
 *         Same state machine, trust model and settlement guarantees as {VaultedEscrow}. Two things
 *         are different, both because of what the first version made impossible in practice.
 *
 *         1. EITHER SIDE CAN CREATE THE ESCROW
 *         ------------------------------------
 *         In v1 the escrow's payee was always `msg.sender`, so only the freelancer could create one
 *         — and a freelancer with an empty wallet cannot send a transaction at all. Gas on a cheap
 *         chain is a fraction of a cent, but a balance of zero is a balance of zero, and the person
 *         with nothing is exactly the person a freelance marketplace has to work for.
 *
 *         {createEscrowFor} lets the client create the escrow and name the freelancer as payee.
 *         Combined with {fund} it means the client pays for everything and the freelancer signs
 *         nothing on chain: they are paid by {release}, or by the permissionless {executeTimeout}
 *         that anybody — including the client, or a bot — can call. A freelancer can go from hired
 *         to paid holding no balance at any point.
 *
 *         Nobody gains authority they did not have. Whoever creates the escrow is bound by it the
 *         same way: the creator of a {createEscrowFor} escrow is its payer, and a payer can only
 *         release to the payee, dispute, or wait. Being named payee is a right to receive money and
 *         nothing else, which is why it needs no consent to confer.
 *
 *         2. IDS ARE NAMESPACED BY BOTH PARTIES
 *         --------------------------------------
 *         v1 derived the id from the payee and a salt, which was safe only because the payee was the
 *         sole creator. Once anyone may name any payee, that scheme lets a stranger create a junk
 *         escrow on an id somebody else was about to use and permanently block it — ids are never
 *         reopened, deliberately, so a squatted id is dead. Folding the payer in closes it: an
 *         attacker cannot occupy an id without being one of its two parties, and the only party who
 *         can squat a pair's id is the pair itself.
 *
 * @dev    ASSETS. One deployment serves the chain's native currency and exactly one ERC-20, fixed as
 *         an immutable at construction. The asset is chosen per escrow, `address(0)` meaning native.
 *
 *         Deliberately not an open allowlist. v1's guarantee was that no malicious token could ever
 *         be introduced after deployment, and accepting an arbitrary caller-supplied asset would
 *         hand that away — an attacker-authored token controls its own transfer logic, and a
 *         contract holding real escrows should never call into one. Two assets, both fixed at
 *         construction, keeps that property exactly as strong while covering what a marketplace
 *         actually denominates work in.
 *
 *         Native transfers hand control to the recipient in a way an ERC-20 transfer of a known-good
 *         token does not, so every settlement path writes its state and decrements the locked total
 *         before it moves anything, on top of the reentrancy guard. There is no `receive()`: ether
 *         can only arrive through {fund}, so the contract never holds a balance it is not accounting
 *         for.
 */
contract VaultedEscrowV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum State {
        None, // 0 — escrow id was never created
        Created, // 1 — terms are on chain, awaiting funding
        Funded, // 2 — funds are locked, protection window running
        Released, // 3 — terminal: full amount settled to the payee
        Disputed, // 4 — funds locked, settlement paused pending arbitration or concession
        Refunded, // 5 — terminal: full amount returned to the payer
        Cancelled, // 6 — terminal: never funded, terms withdrawn
        Resolved // 7 — terminal: arbiter split the amount between payer and payee
    }

    /// @notice Why an escrow settled to the payee. Emitted with {EscrowReleased}.
    enum ReleaseTrigger {
        PayerRelease, // the payer released early / conceded a dispute
        Timeout // the protection window elapsed and the settlement was executed permissionlessly
    }

    /// @dev Packs into five storage slots.
    struct Escrow {
        address payer; //            slot 0 (20 bytes) — never zero: an escrow always has both parties
        uint96 amount; //            slot 0 (12 bytes) — in the asset's base units
        address payee; //            slot 1 (20 bytes)
        State state; //              slot 1 (1 byte)
        uint64 createdAt; //         slot 1 (8 bytes)
        uint64 fundedAt; //          slot 2 (8 bytes) — zero until funded
        uint64 expiresAt; //         slot 2 (8 bytes) — zero until funded
        uint64 fundingDeadline; //   slot 2 (8 bytes) — zero means the link never goes stale
        uint64 protectionPeriod; //  slot 2 (8 bytes) — seconds from funding to expiry
        bytes32 detailsHash; //      slot 3 — commitment to the off-chain invoice terms
        address asset; //            slot 4 (20 bytes) — zero means the chain's native currency
    }

    /// @notice Read model for clients: the stored escrow plus the time-derived facts.
    struct EscrowView {
        Escrow escrow;
        bool exists;
        bool isExpired; // funded, and the protection window has elapsed
        bool canTimeout; // isExpired, so {executeTimeout} would succeed right now
        bool canDispute; // funded, and the protection window is still open
        uint64 secondsUntilExpiry; // zero once expired or before funding
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Protection window applied when an escrow is created with `protectionPeriod == 0`.
    uint64 public constant DEFAULT_PROTECTION_PERIOD = 24 hours;

    /// @notice Floor on the protection window, so an escrow cannot be created that is effectively
    ///         auto-releasing and strips the payer of any chance to dispute.
    uint64 public constant MIN_PROTECTION_PERIOD = 1 hours;

    /// @notice Ceiling on the protection window, so funds cannot be committed indefinitely.
    uint64 public constant MAX_PROTECTION_PERIOD = 365 days;

    /// @notice The asset value meaning "the chain's native currency" rather than an ERC-20.
    address public constant NATIVE_ASSET = address(0);

    // ---------------------------------------------------------------------
    // Immutables and storage
    // ---------------------------------------------------------------------

    /// @notice The one ERC-20 this deployment escrows, alongside the native currency. Fixed forever.
    IERC20 public immutable token;

    /// @notice Decimals reported by {token} at deployment, cached for clients. Display only —
    ///         no accounting in this contract depends on it.
    uint8 public immutable tokenDecimals;

    /// @notice Trusted party allowed to settle disputed escrows. See the TRUST MODEL notes on
    ///         {VaultedEscrow}, which apply here unchanged.
    ///         May be the zero address, in which case disputes can only end by concession.
    address public arbiter;

    /// @notice Arbiter nominated by {transferArbiter}, pending its own {acceptArbiter} call.
    address public pendingArbiter;

    /// @notice Sum of every unsettled escrow amount, per asset. {rescue} may never touch this.
    /// @dev    Per asset rather than a single total: the two are held in different places (this
    ///         contract's ether balance and its token balance) and a shared counter would let a
    ///         rescue of one asset be capped by the other's escrows, or worse, not capped at all.
    mapping(address asset => uint256 locked) public totalLocked;

    mapping(bytes32 escrowId => Escrow) private _escrows;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event EscrowCreated(
        bytes32 indexed escrowId,
        address indexed payee,
        address indexed payer,
        address asset,
        uint96 amount,
        uint64 protectionPeriod,
        uint64 fundingDeadline,
        bytes32 detailsHash,
        bytes32 salt,
        uint64 createdAt,
        address creator
    );

    event EscrowFunded(
        bytes32 indexed escrowId, address indexed payer, uint96 amount, uint64 fundedAt, uint64 expiresAt
    );

    event EscrowReleased(
        bytes32 indexed escrowId, address indexed payee, uint96 amount, ReleaseTrigger trigger, address caller
    );

    event EscrowRefunded(bytes32 indexed escrowId, address indexed payer, uint96 amount, address caller);

    event EscrowDisputed(bytes32 indexed escrowId, address indexed payer, uint64 disputedAt, bytes32 evidenceHash);

    event DisputeResolved(
        bytes32 indexed escrowId, address indexed arbiter, uint96 payeeAmount, uint96 payerAmount, bytes32 rulingHash
    );

    event EscrowCancelled(bytes32 indexed escrowId, address indexed caller);

    event ArbiterTransferStarted(address indexed currentArbiter, address indexed pendingArbiter);
    event ArbiterTransferred(address indexed previousArbiter, address indexed newArbiter);

    event Rescued(address indexed rescuedAsset, address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error EscrowAlreadyExists(bytes32 escrowId);
    error EscrowNotFound(bytes32 escrowId);
    error InvalidState(bytes32 escrowId, State actual);
    error PayerIsPayee();
    error InvalidPayer();
    error InvalidPayee();
    error UnsupportedAsset(address asset);
    error ProtectionPeriodOutOfRange(uint64 protectionPeriod);
    error FundingDeadlineInPast(uint64 fundingDeadline);
    error FundingDeadlinePassed(uint64 fundingDeadline);
    error NotPayer(address caller, address payer);
    error NotPayee(address caller, address payee);
    error NotArbiter(address caller, address arbiter);
    error NotPendingArbiter(address caller, address pendingArbiter);
    error ArbitrationUnavailable();
    error NotYetExpired(uint64 expiresAt);
    error ProtectionWindowClosed(uint64 expiresAt);
    error AmountExceedsEscrow(uint96 requested, uint96 available);
    error UnexpectedAmountReceived(uint96 expected, uint256 received);
    error NativeValueMismatch(uint96 expected, uint256 received);
    error NativeValueNotAccepted();
    error NativeTransferFailed(address to, uint256 amount);
    error NothingToRescue();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /**
     * @param token_   The one ERC-20 this deployment escrows alongside native currency. Immutable.
     * @param arbiter_ Trusted dispute settler, or the zero address to deploy with no arbitration
     *                 path at all (disputes then end only by concession).
     */
    constructor(IERC20 token_, address arbiter_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;

        // Purely informational for clients; a token that does not implement it is still usable.
        uint8 decimals_ = 18;
        try IERC20Metadata(address(token_)).decimals() returns (uint8 value) {
            decimals_ = value;
        } catch {}
        tokenDecimals = decimals_;

        arbiter = arbiter_;
        emit ArbiterTransferred(address(0), arbiter_);
    }

    // ---------------------------------------------------------------------
    // Escrow lifecycle
    // ---------------------------------------------------------------------

    /**
     * @notice Publish the terms of a payment request on chain. Caller becomes the payee.
     * @dev    The freelancer-created route, unchanged in spirit from v1 except that the payer is now
     *         required rather than optional. v1 allowed a zero payer as an "open link" whose first
     *         funder became the payer; that cannot survive ids being namespaced by both parties,
     *         since the id would have to be known before the payer is. Every escrow here is between
     *         two named parties, which is what a hire is anyway.
     * @param payer            The client expected to fund this escrow.
     * @param asset            {NATIVE_ASSET} for the chain's own currency, or {token}.
     * @param amount           Amount in the asset's base units. Must be exactly what the payer sends.
     * @param protectionPeriod Seconds between funding and expiry. Zero selects
     *                         {DEFAULT_PROTECTION_PERIOD}; otherwise it must sit within
     *                         [{MIN_PROTECTION_PERIOD}, {MAX_PROTECTION_PERIOD}].
     * @param fundingDeadline  Unix timestamp after which the link can no longer be funded and anyone
     *                         may cancel it. Zero means the link never goes stale.
     * @param detailsHash      Optional commitment to the off-chain invoice. Zero opts out.
     * @param salt             Caller-chosen uniqueness value; the application uses the invoice id.
     * @return escrowId        Deterministic id, also obtainable up front from {computeEscrowId}.
     */
    function createEscrow(
        address payer,
        address asset,
        uint96 amount,
        uint64 protectionPeriod,
        uint64 fundingDeadline,
        bytes32 detailsHash,
        bytes32 salt
    ) external returns (bytes32 escrowId) {
        return _create(msg.sender, payer, asset, amount, protectionPeriod, fundingDeadline, detailsHash, salt);
    }

    /**
     * @notice Publish the terms on chain on the freelancer's behalf. Caller becomes the payer.
     * @dev    The reason this contract exists. See the note at the top: it is what lets a freelancer
     *         with an empty wallet be hired and paid without ever sending a transaction.
     * @param payee The freelancer who will be paid. Needs no balance and takes no action here.
     */
    function createEscrowFor(
        address payee,
        address asset,
        uint96 amount,
        uint64 protectionPeriod,
        uint64 fundingDeadline,
        bytes32 detailsHash,
        bytes32 salt
    ) external returns (bytes32 escrowId) {
        return _create(payee, msg.sender, asset, amount, protectionPeriod, fundingDeadline, detailsHash, salt);
    }

    /// @dev Shared by both creation routes; they differ only in which party the caller is.
    function _create(
        address payee,
        address payer,
        address asset,
        uint96 amount,
        uint64 protectionPeriod,
        uint64 fundingDeadline,
        bytes32 detailsHash,
        bytes32 salt
    ) private returns (bytes32 escrowId) {
        if (amount == 0) revert ZeroAmount();
        if (payee == address(0)) revert InvalidPayee();
        if (payer == address(0)) revert InvalidPayer();
        if (payer == payee) revert PayerIsPayee();
        if (payer == address(this) || payee == address(this)) revert InvalidPayer();
        if (asset != NATIVE_ASSET && asset != address(token)) revert UnsupportedAsset(asset);

        uint64 period = protectionPeriod == 0 ? DEFAULT_PROTECTION_PERIOD : protectionPeriod;
        if (period < MIN_PROTECTION_PERIOD || period > MAX_PROTECTION_PERIOD) {
            revert ProtectionPeriodOutOfRange(period);
        }
        if (fundingDeadline != 0 && fundingDeadline <= block.timestamp) {
            revert FundingDeadlineInPast(fundingDeadline);
        }

        escrowId = computeEscrowId(payee, payer, salt);
        Escrow storage e = _escrows[escrowId];
        // Any non-None state means this id was used before. Terminal states are never reopened,
        // which is what stops a settled escrow from being replayed under the same id.
        if (e.state != State.None) revert EscrowAlreadyExists(escrowId);

        e.payer = payer;
        e.amount = amount;
        e.payee = payee;
        e.state = State.Created;
        e.createdAt = uint64(block.timestamp);
        e.fundingDeadline = fundingDeadline;
        e.protectionPeriod = period;
        e.detailsHash = detailsHash;
        e.asset = asset;

        emit EscrowCreated(
            escrowId,
            payee,
            payer,
            asset,
            amount,
            period,
            fundingDeadline,
            detailsHash,
            salt,
            uint64(block.timestamp),
            msg.sender
        );
    }

    /**
     * @notice Lock the escrow amount. Starts the payer's protection window.
     * @dev    Native escrows take the amount from `msg.value` and must match it exactly. ERC-20
     *         escrows pull exactly `amount` and verify the balance moved by that much, so a token
     *         that skims a fee on transfer is rejected rather than silently under-funding — and must
     *         carry no value, so ether cannot be stranded here by a mistaken call.
     */
    function fund(bytes32 escrowId) external payable nonReentrant {
        Escrow storage e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        if (e.state != State.Created) revert InvalidState(escrowId, e.state);
        if (e.fundingDeadline != 0 && block.timestamp > e.fundingDeadline) {
            revert FundingDeadlinePassed(e.fundingDeadline);
        }
        if (msg.sender != e.payer) revert NotPayer(msg.sender, e.payer);

        uint96 amount = e.amount;
        address asset = e.asset;
        uint64 fundedAt = uint64(block.timestamp);
        uint64 expiresAt = fundedAt + e.protectionPeriod;

        // Effects before any interaction; the guard plus the state change make a reentrant fund()
        // on the same escrow impossible.
        e.state = State.Funded;
        e.fundedAt = fundedAt;
        e.expiresAt = expiresAt;
        totalLocked[asset] += amount;

        if (asset == NATIVE_ASSET) {
            if (msg.value != amount) revert NativeValueMismatch(amount, msg.value);
        } else {
            if (msg.value != 0) revert NativeValueNotAccepted();
            uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
            uint256 received = IERC20(asset).balanceOf(address(this)) - balanceBefore;
            if (received != amount) revert UnexpectedAmountReceived(amount, received);
        }

        emit EscrowFunded(escrowId, msg.sender, amount, fundedAt, expiresAt);
    }

    /**
     * @notice Payer settles the escrow to the payee. Allowed while funded, after expiry, and while
     *         disputed — releasing is always the payer giving up their own claim, so it is never
     *         adversarial to them.
     */
    function release(bytes32 escrowId) external nonReentrant {
        Escrow storage e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        if (e.state != State.Funded && e.state != State.Disputed) revert InvalidState(escrowId, e.state);
        if (msg.sender != e.payer) revert NotPayer(msg.sender, e.payer);

        _settleToPayee(escrowId, e, ReleaseTrigger.PayerRelease);
    }

    /**
     * @notice Anyone settles an expired escrow to the payee. This is the guarantee that a paid
     *         freelancer never needs the client — or this contract's operator — to cooperate, and
     *         with {createEscrowFor} it is also how a freelancer holding no balance gets paid
     *         without ever sending a transaction.
     */
    function executeTimeout(bytes32 escrowId) external nonReentrant {
        Escrow storage e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        // Disputed escrows are excluded on purpose: a dispute pauses the timeout path.
        if (e.state != State.Funded) revert InvalidState(escrowId, e.state);
        if (block.timestamp < e.expiresAt) revert NotYetExpired(e.expiresAt);

        _settleToPayee(escrowId, e, ReleaseTrigger.Timeout);
    }

    /**
     * @notice Payee returns the funds to the payer. Available while funded and while disputed, so a
     *         freelancer can always concede without waiting on an arbiter.
     */
    function refund(bytes32 escrowId) external nonReentrant {
        Escrow storage e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        if (e.state != State.Funded && e.state != State.Disputed) revert InvalidState(escrowId, e.state);
        if (msg.sender != e.payee) revert NotPayee(msg.sender, e.payee);

        address payer = e.payer;
        address asset = e.asset;
        uint96 amount = e.amount;

        e.state = State.Refunded;
        totalLocked[asset] -= amount;

        _payout(asset, payer, amount);
        emit EscrowRefunded(escrowId, payer, amount, msg.sender);
    }

    /**
     * @notice Payer pauses settlement while the protection window is still open.
     * @dev    Must be raised strictly before expiry. Allowing it afterwards would let a client sit
     *         on an escrow and then block the permissionless timeout at the last moment.
     * @param evidenceHash Optional commitment to off-chain evidence. Zero opts out.
     */
    function dispute(bytes32 escrowId, bytes32 evidenceHash) external {
        Escrow storage e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        if (e.state != State.Funded) revert InvalidState(escrowId, e.state);
        if (msg.sender != e.payer) revert NotPayer(msg.sender, e.payer);
        if (block.timestamp >= e.expiresAt) revert ProtectionWindowClosed(e.expiresAt);

        e.state = State.Disputed;
        emit EscrowDisputed(escrowId, msg.sender, uint64(block.timestamp), evidenceHash);
    }

    /**
     * @notice Arbiter splits a disputed escrow between its payee and its payer.
     * @dev    The arbiter is a trusted external party. Its authority is bounded to exactly this:
     *         a disputed escrow, split between that escrow's own two participants.
     * @param payeeAmount Share for the payee, from 0 to the full escrow amount. The remainder goes
     *                    back to the payer.
     * @param rulingHash  Optional commitment to the off-chain ruling. Zero opts out.
     */
    function resolveDispute(bytes32 escrowId, uint96 payeeAmount, bytes32 rulingHash) external nonReentrant {
        address arbiter_ = arbiter;
        if (arbiter_ == address(0)) revert ArbitrationUnavailable();
        if (msg.sender != arbiter_) revert NotArbiter(msg.sender, arbiter_);

        Escrow storage e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        if (e.state != State.Disputed) revert InvalidState(escrowId, e.state);

        uint96 amount = e.amount;
        if (payeeAmount > amount) revert AmountExceedsEscrow(payeeAmount, amount);
        uint96 payerAmount = amount - payeeAmount;

        address payee = e.payee;
        address payer = e.payer;
        address asset = e.asset;

        e.state = State.Resolved;
        totalLocked[asset] -= amount;

        if (payeeAmount != 0) _payout(asset, payee, payeeAmount);
        if (payerAmount != 0) _payout(asset, payer, payerAmount);

        emit DisputeResolved(escrowId, arbiter_, payeeAmount, payerAmount, rulingHash);
    }

    /**
     * @notice Withdraw an unfunded escrow. Either party may cancel at any time before funding; once
     *         the funding deadline has passed anyone may, so stale rows can be tidied by an indexer.
     * @dev    Only reachable from `Created`, where the contract holds nothing for this escrow. Both
     *         parties may call it because either may have created it.
     */
    function cancel(bytes32 escrowId) external {
        Escrow storage e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        if (e.state != State.Created) revert InvalidState(escrowId, e.state);

        bool deadlinePassed = e.fundingDeadline != 0 && block.timestamp > e.fundingDeadline;
        if (msg.sender != e.payee && msg.sender != e.payer && !deadlinePassed) {
            revert NotPayee(msg.sender, e.payee);
        }

        e.state = State.Cancelled;
        emit EscrowCancelled(escrowId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Internal settlement
    // ---------------------------------------------------------------------

    /**
     * @dev Shared terminal path for both routes that pay the payee: {release} and {executeTimeout}.
     *      State is written and the locked total decremented before the transfer, so even a
     *      recipient that takes control mid-transfer finds an already-settled escrow.
     */
    function _settleToPayee(bytes32 escrowId, Escrow storage e, ReleaseTrigger trigger) private {
        address payee = e.payee;
        address asset = e.asset;
        uint96 amount = e.amount;

        e.state = State.Released;
        totalLocked[asset] -= amount;

        _payout(asset, payee, amount);
        emit EscrowReleased(escrowId, payee, amount, trigger, msg.sender);
    }

    /**
     * @dev The one place value leaves this contract.
     *
     *      A native transfer runs the recipient's code, which an ERC-20 transfer of a known-good
     *      token does not. Every caller has already written its state and decremented the locked
     *      total, and every path here is behind the reentrancy guard, so a recipient that calls back
     *      finds a settled escrow and a guarded door. `call` rather than `transfer` because the
     *      2300-gas stipend is not enough for a smart-contract wallet, and a freelancer using one
     *      must still be payable. A failed send reverts the settlement rather than being swallowed.
     */
    function _payout(address asset, address to, uint256 amount) private {
        if (asset == NATIVE_ASSET) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed(to, amount);
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    // ---------------------------------------------------------------------
    // Arbiter administration
    // ---------------------------------------------------------------------

    /// @notice Nominate a new arbiter. Two-step: the nominee must call {acceptArbiter}.
    function transferArbiter(address newArbiter) external {
        if (msg.sender != arbiter) revert NotArbiter(msg.sender, arbiter);
        if (newArbiter == address(0)) revert ZeroAddress();
        pendingArbiter = newArbiter;
        emit ArbiterTransferStarted(msg.sender, newArbiter);
    }

    /// @notice Accept a pending arbiter nomination.
    function acceptArbiter() external {
        if (msg.sender != pendingArbiter) revert NotPendingArbiter(msg.sender, pendingArbiter);
        address previous = arbiter;
        arbiter = msg.sender;
        pendingArbiter = address(0);
        emit ArbiterTransferred(previous, msg.sender);
    }

    /**
     * @notice Permanently give up the arbitration role.
     * @dev    Irreversible. Afterwards every dispute — including already open ones — can only end
     *         by the payer releasing or the payee refunding.
     */
    function renounceArbiter() external {
        if (msg.sender != arbiter) revert NotArbiter(msg.sender, arbiter);
        arbiter = address(0);
        pendingArbiter = address(0);
        emit ArbiterTransferred(msg.sender, address(0));
    }

    /**
     * @notice Recover assets that reached this contract by mistake.
     * @dev    Capped at `balance - totalLocked[asset]` for both escrowable assets, so escrowed funds
     *         are mathematically out of reach however the arbiter behaves. Any other token is fully
     *         recoverable, since this contract never has a reason to hold one.
     *
     *         Native is included even though there is no `receive()`: ether can still be forced in
     *         by a self-destructing contract, and unreachable dust is worth nothing to anybody.
     * @param asset {NATIVE_ASSET} for ether, otherwise the token to recover.
     */
    function rescue(address asset, address to) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter(msg.sender, arbiter);
        if (to == address(0)) revert ZeroAddress();

        uint256 balance =
            asset == NATIVE_ASSET ? address(this).balance : IERC20(asset).balanceOf(address(this));
        // Only the two escrowable assets have anything locked; any other token is fully free.
        uint256 amount = balance - totalLocked[asset];
        if (amount == 0) revert NothingToRescue();

        _payout(asset, to, amount);
        emit Rescued(asset, to, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /**
     * @notice Deterministic escrow id for a payee/payer/salt triple. Callable before creation, so
     *         the application can mint the id alongside the invoice row and link the two.
     * @dev    Namespaced by both parties, which is what makes {createEscrowFor} safe to expose: a
     *         stranger cannot occupy the id a pair is about to use, because the id is not theirs to
     *         reach. Chain id and contract address are folded in so an id is never meaningful on a
     *         different deployment.
     */
    function computeEscrowId(address payee, address payer, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), payee, payer, salt));
    }

    /// @notice Raw stored escrow. Reverts if the id was never created.
    function getEscrow(bytes32 escrowId) external view returns (Escrow memory) {
        Escrow memory e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        return e;
    }

    /// @notice Stored escrow plus derived timing facts. Never reverts; check `exists`.
    function getEscrowView(bytes32 escrowId) external view returns (EscrowView memory view_) {
        Escrow memory e = _escrows[escrowId];
        view_.escrow = e;
        view_.exists = e.state != State.None;

        if (e.state == State.Funded) {
            view_.isExpired = block.timestamp >= e.expiresAt;
            view_.canTimeout = view_.isExpired;
            view_.canDispute = !view_.isExpired;
            view_.secondsUntilExpiry = view_.isExpired ? 0 : e.expiresAt - uint64(block.timestamp);
        }
    }

    /// @notice Current state of an escrow; {State.None} for an id that was never created.
    function stateOf(bytes32 escrowId) external view returns (State) {
        return _escrows[escrowId].state;
    }
}
