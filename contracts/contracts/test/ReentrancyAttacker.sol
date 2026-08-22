// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultedEscrow} from "../VaultedEscrow.sol";
import {IReentrancyAttacker} from "./TestTokens.sol";

/**
 * @dev Test-only. Sits behind a token transfer hook and tries to re-enter the escrow while it is
 *      mid-settlement. Records whether the nested call succeeded so the suite can assert it did not.
 */
contract ReentrancyAttacker is IReentrancyAttacker {
    enum Attack {
        None,
        Release,
        ExecuteTimeout,
        Refund,
        Fund
    }

    VaultedEscrow public immutable escrow;
    IERC20 public immutable token;

    Attack public attack;
    bytes32 public targetEscrowId;

    uint256 public attempts;
    uint256 public successes;
    bytes public lastRevertData;

    constructor(VaultedEscrow escrow_, IERC20 token_) {
        escrow = escrow_;
        token = token_;
    }

    function arm(Attack attack_, bytes32 escrowId) external {
        attack = attack_;
        targetEscrowId = escrowId;
    }

    function approveEscrow(uint256 amount) external {
        token.approve(address(escrow), amount);
    }

    function createEscrow(
        address payer,
        uint96 amount,
        uint64 protectionPeriod,
        uint64 fundingDeadline,
        bytes32 salt
    ) external returns (bytes32) {
        return escrow.createEscrow(payer, amount, protectionPeriod, fundingDeadline, bytes32(0), salt);
    }

    function fund(bytes32 escrowId) external {
        escrow.fund(escrowId);
    }

    function release(bytes32 escrowId) external {
        escrow.release(escrowId);
    }

    function refund(bytes32 escrowId) external {
        escrow.refund(escrowId);
    }

    function onTokenTransfer() external override {
        if (attack == Attack.None) return;
        attempts++;

        bytes memory payload;
        if (attack == Attack.Release) {
            payload = abi.encodeCall(VaultedEscrow.release, (targetEscrowId));
        } else if (attack == Attack.ExecuteTimeout) {
            payload = abi.encodeCall(VaultedEscrow.executeTimeout, (targetEscrowId));
        } else if (attack == Attack.Refund) {
            payload = abi.encodeCall(VaultedEscrow.refund, (targetEscrowId));
        } else {
            payload = abi.encodeCall(VaultedEscrow.fund, (targetEscrowId));
        }

        // Swallow the revert so the outer transaction still completes; the assertion is that the
        // nested call failed, not that the whole flow blew up.
        (bool ok, bytes memory returnData) = address(escrow).call(payload);
        if (ok) {
            successes++;
        } else {
            lastRevertData = returnData;
        }
    }
}
