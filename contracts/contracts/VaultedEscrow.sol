// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VaultedEscrow
 * @notice Trustless, single-token escrow for freelancer payment links.
 *
 *         A payee (freelancer) opens an escrow off a shareable link. The payer (client) funds it
 *         with the stablecoin this contract was deployed for. From the moment of funding the payer
 *         gets a bounded protection window in which they may release the funds early or raise a
 *         dispute. If the window elapses with neither happening, *anyone* may execute the timeout
 *         and the funds settle to the payee.
 *
 *         State machine
 *         -------------
 *           None ── createEscrow ─▶ Created ── fund ─▶ Funded ─┬─ release ────────────▶ Released
 *                                      │                       ├─ executeTimeout ─────▶ Released
 *                                      │                       ├─ refund ─────────────▶ Refunded
 *                                      │                       └─ dispute ──▶ Disputed ─┬─ release ──▶ Released
 *                                      │                                                ├─ refund ───▶ Refunded
 *                                      └─ cancel ─▶ Cancelled                           └─ resolveDispute ─▶ Resolved
 *
 *         `Expired` is not a stored state: it is the derived condition
 *         `state == Funded && block.timestamp >= expiresAt`, exposed through {getEscrowView}.
 *         Making it a stored state would require somebody to pay gas purely to record the passage
 *         of time, so it is computed instead.
 *
 *         TRUST MODEL — read this before assuming what the contract guarantees
 *         --------------------------------------------------------------------
 *         What this contract enforces on its own, with no trusted party:
 *           * Escrowed funds can only ever move to the escrow's own payer or payee.
 *           * Only the payer can release early; only the payee can refund; only the payer can dispute.
 *           * After expiry the timeout settlement is permissionless — the payee never depends on the
 *             payer's cooperation, and never depends on this contract's operator.
 *           * Each escrow settles exactly once. Amounts are tracked per escrow and the aggregate
 *             {totalLocked} is an invariant that {rescue} can never dip below.
 *
 *         What this contract does NOT provide:
 *           * Decentralised arbitration. {dispute} only *pauses* settlement. Deciding a disputed
 *             escrow requires the `arbiter` address configured at deployment — a single, trusted,
 *             external party (an operator key, a multisig, or a bridge into a system such as
 *             Kleros). This is an explicit external dependency, not a property of this contract.
 *           * A guaranteed outcome for a disputed escrow. If the arbiter never acts, the funds stay
 *             locked until one side concedes: the payer can still {release} to the payee, or the
 *             payee can still {refund} to the payer. There is deliberately no automatic fallback,
 *             because any fallback would hand a free win to whichever side it favoured. If `arbiter`
 *             is the zero address, mutual concession is the *only* way out of a dispute.
 *           * Any opinion on whether the off-chain work was actually delivered.
 *
 *         The arbiter's power is bounded by construction: it can act only on escrows already in the
 *         `Disputed` state, and it can only split that escrow's own amount between that escrow's own
 *         payer and payee. It can never move funds to itself or to a third party, never touch a
 *         non-disputed escrow, and never pause, upgrade, or reconfigure the contract.
 *
 * @dev    One deployment serves exactly one ERC-20 token, fixed as an immutable at construction.
 *         There is no token allowlist and no admin able to add one, so a malicious token can never
 *         be introduced after the fact. Support another stablecoin or another chain by deploying
 *         another instance.
 */
contract VaultedEscrow is ReentrancyGuard {
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

    /// @dev Packs into four storage slots.
    struct Escrow {
        address payer; //            slot 0 (20 bytes) — zero until funded on an open link
        uint96 amount; //            slot 0 (12 bytes) — in token base units
        address payee; //            slot 1 (20 bytes)
        State state; //              slot 1 (1 byte)
        uint64 createdAt; //         slot 1 (8 bytes)
        uint64 fundedAt; //          slot 2 (8 bytes) — zero until funded
        uint64 expiresAt; //         slot 2 (8 bytes) — zero until funded
        uint64 fundingDeadline; //   slot 2 (8 bytes) — zero means the link never goes stale
        uint64 protectionPeriod; //  slot 2 (8 bytes) — seconds from funding to expiry
        bytes32 detailsHash; //      slot 3 — commitment to the off-chain invoice terms
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

    /// @notice Floor on the protection window, so a payee cannot create an escrow that is
    ///         effectively auto-releasing and strip the payer of any chance to dispute.
    uint64 public constant MIN_PROTECTION_PERIOD = 1 hours;

    /// @notice Ceiling on the protection window, so funds cannot be committed indefinitely.
    uint64 public constant MAX_PROTECTION_PERIOD = 365 days;

    // ---------------------------------------------------------------------
    // Immutables and storage
    // ---------------------------------------------------------------------

    /// @notice The one ERC-20 this deployment escrows. Fixed forever at construction.
    IERC20 public immutable token;

    /// @notice Decimals reported by {token} at deployment, cached for clients. Display only —
    ///         no accounting in this contract depends on it.
    uint8 public immutable tokenDecimals;

    /// @notice Trusted party allowed to settle disputed escrows. See the TRUST MODEL notes above.
    ///         May be the zero address, in which case disputes can only end by concession.
    address public arbiter;

    /// @notice Arbiter nominated by {transferArbiter}, pending its own {acceptArbiter} call.
    address public pendingArbiter;

    /// @notice Sum of every unsettled escrow amount. {rescue} may never touch this.
    uint256 public totalLocked;

    mapping(bytes32 escrowId => Escrow) private _escrows;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event EscrowCreated(
        bytes32 indexed escrowId,
        address indexed payee,
        address indexed payer,
        uint96 amount,
        uint64 protectionPeriod,
        uint64 fundingDeadline,
        bytes32 detailsHash,
        bytes32 salt,
        uint64 createdAt
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

    event Rescued(address indexed rescuedToken, address indexed to, uint256 amount);

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
    error NothingToRescue();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /**
     * @param token_   ERC-20 stablecoin this deployment escrows. Immutable.
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
     * @param payer            The client expected to fund this escrow. Pass the zero address for an
     *                         open link, where the first funder becomes the payer.
     * @param amount           Amount in {token} base units. Must be exactly what the payer transfers.
     * @param protectionPeriod Seconds between funding and expiry. Zero selects
     *                         {DEFAULT_PROTECTION_PERIOD}; otherwise it must sit within
     *                         [{MIN_PROTECTION_PERIOD}, {MAX_PROTECTION_PERIOD}].
     * @param fundingDeadline  Unix timestamp after which the link can no longer be funded and anyone
     *                         may cancel it. Zero means the link never goes stale.
     * @param detailsHash      Optional commitment to the off-chain invoice (description, amount,
     *                         token, expiry). Lets a client verify the link they opened matches the
     *                         terms recorded on chain. Zero opts out.
     * @param salt             Caller-chosen uniqueness value; the application uses the invoice id.
     *                         Escrow ids are namespaced per payee, so a salt only has to be unique
     *                         for the caller.
     * @return escrowId        Deterministic id, also obtainable up front from {computeEscrowId}.
     */
    function createEscrow(
        address payer,
        uint96 amount,
        uint64 protectionPeriod,
        uint64 fundingDeadline,
        bytes32 detailsHash,
        bytes32 salt
    ) external returns (bytes32 escrowId) {
        if (amount == 0) revert ZeroAmount();
        if (payer == msg.sender) revert PayerIsPayee();
        if (payer == address(this)) revert InvalidPayer();

        uint64 period = protectionPeriod == 0 ? DEFAULT_PROTECTION_PERIOD : protectionPeriod;
        if (period < MIN_PROTECTION_PERIOD || period > MAX_PROTECTION_PERIOD) {
            revert ProtectionPeriodOutOfRange(period);
        }
        if (fundingDeadline != 0 && fundingDeadline <= block.timestamp) {
            revert FundingDeadlineInPast(fundingDeadline);
        }

        escrowId = computeEscrowId(msg.sender, salt);
        Escrow storage e = _escrows[escrowId];
        // Any non-None state means this id was used before. Terminal states are never reopened,
        // which is what stops a settled escrow from being replayed under the same id.
        if (e.state != State.None) revert EscrowAlreadyExists(escrowId);

        e.payer = payer;
        e.amount = amount;
        e.payee = msg.sender;
        e.state = State.Created;
        e.createdAt = uint64(block.timestamp);
        e.fundingDeadline = fundingDeadline;
        e.protectionPeriod = period;
        e.detailsHash = detailsHash;

        emit EscrowCreated(
            escrowId, msg.sender, payer, amount, period, fundingDeadline, detailsHash, salt, uint64(block.timestamp)
        );
    }

    /**
     * @notice Lock the escrow amount. Starts the payer's protection window.
     * @dev    Pulls exactly `amount` and verifies the balance actually moved by that much, so tokens
     *         that skim a fee on transfer are rejected instead of silently under-funding the escrow.
     */
    function fund(bytes32 escrowId) external nonReentrant {
        Escrow storage e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        if (e.state != State.Created) revert InvalidState(escrowId, e.state);
        if (e.fundingDeadline != 0 && block.timestamp > e.fundingDeadline) {
            revert FundingDeadlinePassed(e.fundingDeadline);
        }

        if (e.payer == address(0)) {
            // Open link: the first funder becomes the payer and owns the protection window.
            if (msg.sender == e.payee) revert PayerIsPayee();
            e.payer = msg.sender;
        } else if (msg.sender != e.payer) {
            revert NotPayer(msg.sender, e.payer);
        }

        uint96 amount = e.amount;
        uint64 fundedAt = uint64(block.timestamp);
        uint64 expiresAt = fundedAt + e.protectionPeriod;

        // Effects before the token interaction; the guard plus the state change make a reentrant
        // fund() on the same escrow impossible.
        e.state = State.Funded;
        e.fundedAt = fundedAt;
        e.expiresAt = expiresAt;
        totalLocked += amount;

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert UnexpectedAmountReceived(amount, received);

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
     *         freelancer never needs the client — or this contract's operator — to cooperate.
     * @dev    Deliberately permissionless: a relayer, the payee, or a bot can all call it.
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
        uint96 amount = e.amount;

        e.state = State.Refunded;
        totalLocked -= amount;

        token.safeTransfer(payer, amount);
        emit EscrowRefunded(escrowId, payer, amount, msg.sender);
    }

    /**
     * @notice Payer pauses settlement while the protection window is still open.
     * @dev    Must be raised strictly before expiry. Allowing it afterwards would let a client sit
     *         on an escrow and then block the permissionless timeout at the last moment.
     *
     *         This only pauses settlement. Resolving the dispute needs the trusted `arbiter`, or one
     *         side conceding via {release} / {refund}. See the TRUST MODEL notes on this contract.
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

        e.state = State.Resolved;
        totalLocked -= amount;

        if (payeeAmount != 0) token.safeTransfer(payee, payeeAmount);
        if (payerAmount != 0) token.safeTransfer(payer, payerAmount);

        emit DisputeResolved(escrowId, arbiter_, payeeAmount, payerAmount, rulingHash);
    }

    /**
     * @notice Withdraw an unfunded payment link. The payee may cancel at any time; once the funding
     *         deadline has passed anyone may, so stale links can be tidied up by an indexer.
     * @dev    Only reachable from `Created`, where the contract holds nothing for this escrow.
     */
    function cancel(bytes32 escrowId) external {
        Escrow storage e = _escrows[escrowId];
        if (e.state == State.None) revert EscrowNotFound(escrowId);
        if (e.state != State.Created) revert InvalidState(escrowId, e.state);

        bool deadlinePassed = e.fundingDeadline != 0 && block.timestamp > e.fundingDeadline;
        if (msg.sender != e.payee && !deadlinePassed) revert NotPayee(msg.sender, e.payee);

        e.state = State.Cancelled;
        emit EscrowCancelled(escrowId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Internal settlement
    // ---------------------------------------------------------------------

    /**
     * @dev Shared terminal path for both routes that pay the payee: {release} and {executeTimeout}.
     *      State is written and the locked total is decremented before the transfer, so even a token
     *      that hands control back mid-transfer finds an already-settled escrow.
     */
    function _settleToPayee(bytes32 escrowId, Escrow storage e, ReleaseTrigger trigger) private {
        address payee = e.payee;
        uint96 amount = e.amount;

        e.state = State.Released;
        totalLocked -= amount;

        token.safeTransfer(payee, amount);
        emit EscrowReleased(escrowId, payee, amount, trigger, msg.sender);
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
     * @notice Recover tokens that were sent here by mistake.
     * @dev    For the escrow token this is capped at `balance - totalLocked`, so escrowed funds are
     *         mathematically out of reach however the arbiter behaves. Any other token is fully
     *         recoverable, since this contract never has a reason to hold one.
     */
    function rescue(IERC20 token_, address to) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter(msg.sender, arbiter);
        if (to == address(0)) revert ZeroAddress();

        uint256 balance = token_.balanceOf(address(this));
        uint256 amount = token_ == token ? balance - totalLocked : balance;
        if (amount == 0) revert NothingToRescue();

        token_.safeTransfer(to, amount);
        emit Rescued(address(token_), to, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /**
     * @notice Deterministic escrow id for a payee/salt pair. Callable before creation, so the
     *         application can mint the id alongside the invoice row and link the two.
     * @dev    Namespaced by payee, so one payee can never squat another's id. Chain id and contract
     *         address are folded in so an id is never meaningful on a different deployment.
     */
    function computeEscrowId(address payee, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), payee, salt));
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
