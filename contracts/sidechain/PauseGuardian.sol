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

    address public immutable gaurdian;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _gaurdian) {
        require(_gaurdian != address(0), "gaurdian=0");
        gaurdian = _gaurdian;
    }

    /* -------------------------------------------------------------------
       Modifiers 
    ------------------------------------------------------------------- */

    modifier onlyGaurdian() {
        require(msg.sender == gaurdian, "!gaurdian");
        _;
    }

    /* -------------------------------------------------------------------
       Core 
    ------------------------------------------------------------------- */

    function pause() external onlyGaurdian {
        _pause();
    }

    function unpause() external onlyGaurdian {
        _unpause();
    }
}
