// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import "../interfaces/IChef.sol";

contract MasterChefRewardHook is Ownable {
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

    function deposit(address siphonToken) external onlyOwner {
        IERC20(siphonToken).approve(chef, type(uint256).max);
        uint256 bal = IERC20(siphonToken).balanceOf(address(this));
        require(bal > 0, "!bal");
        IChef(chef).deposit(pid, bal);
    }

    function onRewardClaim() external {
        require(msg.sender == stash, "!auth");

        IChef(chef).claim(pid, address(this));

        uint256 bal = IERC20(rewardToken).balanceOf(address(this));
        if (bal > 0) {
            IERC20(rewardToken).transfer(stash, bal);
        }
    }
}
