// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";

contract BaseBridgeDelegate is Ownable, ReentrancyGuard {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */
    address crv;

    address l1Delegate;

    address l2Coordinator;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _crv) {
        crv = _crv;
    }

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */

    function setL1Delegate(address _l1Delegate) external onlyOwner {
        require(_l1Delegate != address(0), "!0");
        l1Delegate = _l1Delegate;
    }

    function setL2Coordinator(address _l2Coordinator) external onlyOwner {
        require(_l2Coordinator != address(0), "!0");
        l2Coordinator = _l2Coordinator;
    }
}
