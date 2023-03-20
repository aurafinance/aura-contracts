// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

import "../../interfaces/IStrategy.sol";

contract MockStrategy is IStrategy, ERC20 {
    address public lpToken;
    address[] public rewardTokens;

    constructor(address _lptoken, address[] memory _rewardTokens) ERC20("MockStrategy", "mckStg") {
        lpToken = _lptoken;
        rewardTokens = _rewardTokens;
        rewardTokens.push(address(0));
    }

    function harvest() external returns (uint256 harvested) {
        harvested = _harvest(0);
    }

    function harvest(uint256 _minAmountOut) external returns (uint256 harvested) {
        harvested = _harvest(_minAmountOut);
    }

    /// @dev Mocks the harvests based on the balance of the msg.sender,
    ///  this mock must have balance of each different reward token.
    function _harvest(
        uint256 /** _minAmountOut */
    ) internal returns (uint256 harvested) {
        // harvest based on the balance of the `msg.sender`
        uint256 balance = balanceOf(msg.sender);

        for (uint256 i = 0; i < rewardTokens.length; i++) {
            if (rewardTokens[i] == address(0)) break;
            harvested = harvested + ((balance * 10) / 1000);
            IERC20(rewardTokens[i]).transfer(msg.sender, (balance * 10) / 1000);
        }
        return harvested;
    }

    function totalUnderlying() external view returns (uint256 total) {
        total = totalSupply();
    }

    function stake(uint256 _amount) external {
        _mint(msg.sender, _amount);
    }

    function withdraw(uint256 _amount) external {
        _burn(msg.sender, _amount);
        IERC20(lpToken).transfer(msg.sender, _amount);
    }

    function setApprovals() external {
        // setApprovals not used so far
    }
}
