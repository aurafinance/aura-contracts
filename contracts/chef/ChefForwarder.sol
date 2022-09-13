// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import "../interfaces/IChef.sol";

contract ChefForwarder is Ownable {
    uint256 public pid;
    address public briber;
    address public immutable chef;

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
        require(bal > 0, "!bal");
        IChef(chef).deposit(pid, bal);
    }

    function claim(address token) external {
        require(msg.sender == briber, "!briber");
        IChef(chef).claim(pid, address(this));
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).transfer(briber, bal);
        }
    }
}
