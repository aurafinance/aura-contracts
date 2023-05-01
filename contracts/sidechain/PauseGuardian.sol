// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Pausable } from "@openzeppelin/contracts-0.8/security/Pausable.sol";

/**
 * @title PauseGaurdian
 */
contract PauseGaurdian is Pausable {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    address public immutable guardian;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _guardian) {
        require(_guardian != address(0), "guardian=0");
        guardian = _guardian;
    }

    /* -------------------------------------------------------------------
       Modifiers 
    ------------------------------------------------------------------- */

    modifier onlyGuardian() {
        require(msg.sender == guardian, "!guardian");
        _;
    }

    /* -------------------------------------------------------------------
       Core 
    ------------------------------------------------------------------- */

    function pause() external onlyGuardian {
        _pause();
    }

    function unpause() external onlyGuardian {
        _unpause();
    }
}
