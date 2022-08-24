pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

// prettier-ignore
interface ICurveGauge {
    function deposit(uint256) external;
    function balanceOf(address) external view returns (uint256);
    function withdraw(uint256) external;
    function claim_rewards() external;
    function lp_token() external view returns (address);
}

contract SiphonGauge {
    using SafeERC20 for IERC20;

    IERC20 immutable lpToken;

    mapping(address => uint256) private _balances;

    constructor(IERC20 _lpToken) {
        lpToken = _lpToken;
    }

    function deposit(uint256 _amount) external {
        lpToken.safeTransferFrom(msg.sender, address(this), _amount);
        _balances[msg.sender] += _amount;
    }

    function balanceOf(address _account) external view returns (uint256) {
        return _balances[_account];
    }

    function withdraw(uint256 _amount) external {
        _balances[msg.sender] -= _amount;
        lpToken.safeTransfer(msg.sender, _amount);
    }

    function claim_rewards() external {}

    function lp_token() external view returns (address) {
        return address(lpToken);
    }
}
