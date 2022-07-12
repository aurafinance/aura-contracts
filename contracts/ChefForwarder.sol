// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";

interface IChef {
    function deposit(uint256, uint256) external;

    function claim(uint256, address) external;
}

contract ChefForwarder is Ownable {
    uint256 pid;
    address briber;
    address chef;

    constructor(address _chef) {
        chef = _chef;
    }

    function setBriber(address _briber) external onlyOwner {
        briber = _briber;
    }

    function setPid(uint256 _pid) external onlyOwner {
        pid = _pid;
    }

    function deposit(address siphonToken) external onlyOwner {
        IERC20(siphonToken).approve(chef, type(uint256).max);
        uint256 bal = IERC20(siphonToken).balanceOf(address(this));
        IChef(chef).deposit(pid, bal);
    }

    function claim(address token) external {
        require(msg.sender == briber, "!briber");
        uint256 bal = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(briber, bal);
    }
}
