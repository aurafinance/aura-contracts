// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

// @dev - Must be funded by transferring crv to this contract post deployment, as opposed to minting directly
contract MockFeeDistro {
    IERC20 public token;
    uint256 public rate;

    constructor(address _token, uint256 _rate) {
        token = IERC20(_token);
        rate = _rate;
    }

    function claim() external {
        token.transfer(msg.sender, rate);
    }
}
