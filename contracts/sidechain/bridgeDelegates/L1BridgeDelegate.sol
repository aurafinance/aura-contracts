// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";

interface IBooster {
    function distributeL2Fees(uint256 _amount) external;
}

contract L1BridgeDelegate is Ownable, ReentrancyGuard {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */
    address crv;

    address booster;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _crv, address _booster) {
        crv = _crv;
        booster = _booster;
    }

    /* -------------------------------------------------------------------
        Functions
    ------------------------------------------------------------------- */

    function forwardFees(uint256 _amount) external onlyOwner {
        IERC20(crv).approve(booster, _amount);
        IBooster(booster).distributeL2Fees(_amount);
    }
}
