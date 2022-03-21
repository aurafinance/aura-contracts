// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../BalInvestor.sol";

contract TestEthBal is BalInvestor {
    constructor(
        IVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId,
        uint256 _minOutBps
    ) BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId, _minOutBps) {}

    function setMinOutBps(uint256 _minOutBps) external override {
        minOutBps = _minOutBps;
    }

    function getBptPrice() external view returns (uint256) {
        return _getBptPrice();
    }

    function addBalToPool() external {
        _investBalToPool();
    }
}
