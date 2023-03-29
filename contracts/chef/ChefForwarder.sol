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

    /**
     * @notice This function allows the owner to deposit tokens to the Chef contract.
     * @dev The function first approves the Chef contract to transfer tokens from the current contract. It then checks the balance of the current contract and requires it to be greater than 0. Finally, it calls the deposit function of the Chef contract with the current contract's pid and balance.
     */
    function deposit(address siphonToken) external onlyOwner {
        IERC20(siphonToken).approve(chef, type(uint256).max);
        uint256 bal = IERC20(siphonToken).balanceOf(address(this));
        require(bal > 0, "!bal");
        IChef(chef).deposit(pid, bal);
    }

    /**
     * @notice This function allows the briber to claim the token from the contract.
     * @dev The function requires that the msg.sender is the briber. It then calls the IChef contract to claim the pid.
     * If the balance of the token is greater than 0, it will transfer the token to the briber.
     */
    function claim(address token) external {
        require(msg.sender == briber, "!briber");
        IChef(chef).claim(pid, address(this));
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).transfer(briber, bal);
        }
    }
}
