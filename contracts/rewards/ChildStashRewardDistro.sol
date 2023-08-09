// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { StashRewardDistro } from "./StashRewardDistro.sol";

contract ChildStashRewardDistro is StashRewardDistro {
    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _booster) StashRewardDistro(_booster) {}

    /* -------------------------------------------------------------------
       Internal 
    ------------------------------------------------------------------- */

    function _earmarkRewards(uint256 pid) internal override {
        booster.earmarkRewards(pid, address(0));
    }
}
