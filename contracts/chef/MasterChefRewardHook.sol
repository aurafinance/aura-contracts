// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import "../interfaces/IChef.sol";

contract MasterChefRewardHook is Ownable {
    using SafeERC20 for IERC20;

    uint256 public pid;
    address public immutable stash;
    address public immutable chef;
    address public immutable rewardToken;

    constructor(
        address _stash,
        address _chef,
        address _rewardToken
    ) {
        stash = _stash;
        chef = _chef;
        rewardToken = _rewardToken;
    }

    function setPid(uint256 _pid) external onlyOwner {
        pid = _pid;
    }

    /**
     * @notice This function allows the owner to deposit tokens to the Chef contract.
     * @dev The function first approves the Chef contract to transfer the maximum amount of tokens from the current contract. It then checks the balance of the current contract and requires it to be greater than 0. Finally, it calls the deposit function on the Chef contract with the current contract's pid and the balance of tokens.
     */
    function deposit(address siphonToken) external onlyOwner {
        IERC20(siphonToken).approve(chef, type(uint256).max);
        uint256 bal = IERC20(siphonToken).balanceOf(address(this));
        require(bal > 0, "!bal");
        IChef(chef).deposit(pid, bal);
    }

    /**
     * @notice This function allows the stash to claim rewards from the Chef contract.
     * @dev The function requires that the msg.sender is the stash. It then calls the Chef contract's claim function with the pid and address of this contract. It then checks the balance of the reward token and if it is greater than 0, it transfers the balance to the stash.
     */
    function onRewardClaim() external {
        require(msg.sender == stash, "!auth");

        IChef(chef).claim(pid, address(this));

        uint256 bal = IERC20(rewardToken).balanceOf(address(this));
        if (bal > 0) {
            IERC20(rewardToken).safeTransfer(stash, bal);
        }
    }
}
