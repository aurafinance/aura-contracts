// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

contract MockCurveGauge is ERC20 {
    address public lptoken;

    address public rewardedToken;

    address[] public rewardTokens;

    constructor(
        string memory _name,
        string memory _symbol,
        address _lptoken,
        address _rewardedToken,
        address[] memory _rewardTokens
    ) ERC20(_name, _symbol) {
        lptoken = _lptoken;
        rewardedToken = _rewardedToken;
        rewardTokens = _rewardTokens;
    }

    function deposit(uint256 amount) external {
        _mint(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function claim_rewards() external {
        uint256 amount = balanceOf(msg.sender);

        for (uint256 i = 0; i < rewardTokens.length; i++) {
            IERC20(rewardTokens[i]).transfer(msg.sender, amount);
        }
    }

    // V2 gauge
    function reward_tokens(uint256 i) external view returns (address) {
        return rewardTokens[i];
    }

    function lp_token() external view returns (address) {
        return lptoken;
    }
}
