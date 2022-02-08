// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "./MockWalletChecker.sol";

contract MockCurveVoteEscrow {
    address public smart_wallet_checker;

    address public token;

    mapping(address => uint256) public lockAmounts;

    mapping(address => uint256) public lockTimes;

    constructor(address _smart_wallet_checker, address _token) {
        smart_wallet_checker = _smart_wallet_checker;
        token = _token;
    }

    function create_lock(uint256 amount, uint256 unlockTime) external {
        require(MockWalletChecker(smart_wallet_checker).check(msg.sender), "!contracts");
        require(lockAmounts[msg.sender] == 0, "Withdraw old tokens first");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        lockAmounts[msg.sender] = amount;
        lockTimes[msg.sender] = unlockTime;
    }

    function increase_amount(uint256 amount) external {
        lockAmounts[msg.sender] += amount;
    }

    function increase_unlock_time(uint256 time) external {
        lockTimes[msg.sender] += time;
    }

    function withdraw() external {
        require(lockTimes[msg.sender] < block.timestamp, "!unlocked");
        uint256 amount = IERC20(token).balanceOf(msg.sender);
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }
}
