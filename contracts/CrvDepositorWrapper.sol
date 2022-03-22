// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "./Interfaces.sol";
import "./BalInvestor.sol";

interface ICrvDepositor {
    function depositFor(
        address to,
        uint256 _amount,
        bool _lock,
        address _stakeAddress
    ) external;
}

contract CrvDepositorWrapper is BalInvestor {
    address public crvDeposit;

    constructor(
        address _crvDeposit,
        IVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId
    ) BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId) {
        crvDeposit = _crvDeposit;
    }

    function setApprovals() public {
        _setApprovals();
        IERC20(BALANCER_POOL_TOKEN).approve(crvDeposit, type(uint256).max);
    }

    function getMinOut(uint256 _amount) public view returns (uint256) {
        return _getMinOut(_amount, 9975);
    }

    function deposit(
        uint256 _amount,
        uint256 _minOut,
        bool _lock
    ) public {
        _investBalToPool(_amount, _minOut);
        uint256 bptBalance = IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
        ICrvDepositor(crvDeposit).depositFor(msg.sender, bptBalance, _lock, address(0));
    }
}
