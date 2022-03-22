// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "../BalInvestor.sol";

contract TestEthBal is BalInvestor {
    constructor(
        IVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId
    ) BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId) {}

    function approveToken() external {
        _setApprovals();
    }

    function getBptPrice() external view returns (uint256) {
        return _getBptPrice();
    }

    function addBalToPool(uint256 amount) external {
        uint256 minOut = _getMinOut(amount, 9975);
        _investBalToPool(amount, minOut);
    }
}
