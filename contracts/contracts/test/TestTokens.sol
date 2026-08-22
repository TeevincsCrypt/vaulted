// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Test-only ERC-20s. These exist purely so the escrow's behaviour against hostile and
 *      non-standard tokens can be proven in the test suite. Nothing here is ever deployed to a
 *      public network — production deployments point at a real stablecoin.
 */

/// @dev Faithful 6-decimal stand-in for USDC, used for the happy paths.
contract MockUSDC is ERC20 {
    uint8 private immutable _decimals;

    constructor(uint8 decimals_) ERC20("Mock USD Coin", "USDC") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Skims a percentage on every transfer, so the escrow receives less than it pulled.
contract FeeOnTransferToken is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 feeBps_) ERC20("Fee On Transfer", "FOT") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, to, value - fee);
        super._update(from, address(0), fee); // burn the fee
    }
}

/// @dev Returns `false` instead of reverting on failure, the way some legacy tokens do.
contract FalseReturningToken is IERC20 {
    string public constant name = "False Returning";
    string public constant symbol = "FALSE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bool public failTransfer;
    bool public failTransferFrom;

    function setFailures(bool failTransfer_, bool failTransferFrom_) external {
        failTransfer = failTransfer_;
        failTransferFrom = failTransferFrom_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfer) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (failTransferFrom) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev USDT-style: transfer functions return nothing at all.
contract NoReturnValueToken {
    string public constant name = "No Return";
    string public constant symbol = "NORET";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @dev Reverts outright on transfer, standing in for a paused or blocklisting stablecoin.
contract RevertingToken is ERC20 {
    bool public revertOnTransfer;
    bool public revertOnTransferFrom;

    constructor() ERC20("Reverting", "RVT") {}

    function setReverts(bool onTransfer, bool onTransferFrom) external {
        revertOnTransfer = onTransfer;
        revertOnTransferFrom = onTransferFrom;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!revertOnTransfer, "RevertingToken: transfer blocked");
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(!revertOnTransferFrom, "RevertingToken: transferFrom blocked");
        return super.transferFrom(from, to, amount);
    }
}

/// @dev Token with no `decimals()` function, to prove the constructor's try/catch fallback.
contract NoDecimalsToken is IERC20 {
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @dev ERC-777-style token that hands control to a hook contract in the middle of a transfer.
 *      This is the vector a naive escrow would fall to, so the suite uses it to prove the
 *      reentrancy guard and the checks-effects-interactions ordering actually hold.
 */
contract ReentrantToken is ERC20 {
    IReentrancyAttacker public attacker;
    bool public hookEnabled;

    constructor() ERC20("Reentrant", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAttacker(IReentrancyAttacker attacker_) external {
        attacker = attacker_;
    }

    function setHookEnabled(bool enabled) external {
        hookEnabled = enabled;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hookEnabled && address(attacker) != address(0)) {
            // Re-enter exactly once per transfer, the way an ERC-777 receive hook would.
            hookEnabled = false;
            attacker.onTokenTransfer();
            hookEnabled = true;
        }
    }
}

interface IReentrancyAttacker {
    function onTokenTransfer() external;
}
