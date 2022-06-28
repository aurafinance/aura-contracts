// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

interface IBooster {
    function earmarkRewards(uint256 _pid) external returns (bool);
}

/**
 * @title   BoosterHelper
 * @author  AuraFinance
 * @notice  Invokes booster.earmarkRewards for multiple pools.
 * @dev     Allows anyone to call `earmarkRewards`  via the booster.
 */
contract BoosterHelper {
    using SafeERC20 for IERC20;

    IBooster public immutable booster;
    address public immutable crv;

    /**
     * @param _booster      Booster.sol, e.g. 0xF403C135812408BFbE8713b5A23a04b3D48AAE31
     * @param _crv          Crv  e.g. 0xba100000625a3754423978a60c9317c58a424e3D
     */
    constructor(address _booster, address _crv) {
        booster = IBooster(_booster);
        crv = _crv;
    }

    function earmarkRewards(uint256[] memory _pids) external returns (uint256) {
        uint256 len = _pids.length;
        require(len > 0, "!pids");

        for (uint256 i = 0; i < len; i++) {
            require(booster.earmarkRewards(_pids[i]), "!earmark reward");
        }
        // Return all incentives to the sender
        uint256 crvBal = IERC20(crv).balanceOf(address(this));
        IERC20(crv).safeTransfer(msg.sender, crvBal);
        return crvBal;
    }
}
