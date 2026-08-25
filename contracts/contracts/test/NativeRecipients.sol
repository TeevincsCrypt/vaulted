// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * Recipients that behave badly when paid in the chain's native currency.
 *
 * Native payouts are the one place VaultedEscrowV2 hands control to an address it knows nothing
 * about — an ERC-20 transfer of the single known-good token does not. These exist so the tests can
 * exercise that hand-off for real rather than assuming it is safe.
 */
interface IEscrowNative {
    function release(bytes32 escrowId) external;
    function executeTimeout(bytes32 escrowId) external;
    function refund(bytes32 escrowId) external;
    function fund(bytes32 escrowId) external payable;
}

/// Refuses every incoming transfer, so a settlement to it cannot silently succeed.
contract RejectsNative {
    receive() external payable {
        revert("no thanks");
    }
}

/// Accepts ether, and calls straight back into the escrow while being paid.
contract ReentrantNativeRecipient {
    IEscrowNative public escrow;
    bytes32 public target;
    bool public attempted;
    bool public reentered;

    function arm(address escrow_, bytes32 escrowId) external {
        escrow = IEscrowNative(escrow_);
        target = escrowId;
    }

    /// Lets a test fund an escrow from this contract, so it can be the payer as well as a payee.
    function fund(bytes32 escrowId) external payable {
        escrow.fund{value: msg.value}(escrowId);
    }

    receive() external payable {
        if (address(escrow) == address(0) || attempted) return;
        attempted = true;
        // Re-entering a guarded function must fail. Swallowed so the outer payout is not reverted
        // by this call — the test asserts on `reentered` rather than on a bubbled revert.
        try escrow.executeTimeout(target) {
            reentered = true;
        } catch {}
    }
}
