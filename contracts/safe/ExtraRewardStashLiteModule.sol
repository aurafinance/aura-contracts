// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IBooster } from "../interfaces/IBooster.sol";
import { ExtraRewardStashModule } from "./ExtraRewardStashModule.sol";

/**
 * @author  Aura Finance
 * @notice  This module allows a keeper to add extra reward tokens to a stash
 */
contract ExtraRewardStashLiteModule is ExtraRewardStashModule {
    /**
     * @param _owner: owner of the contract
     * @param _safeWallet: address of the SafeWallet contract
     * @param _boosterOwner: address of the BoosterOwner contract
     * @param _booster: address of the Booster contract
     */
    constructor(
        address _owner,
        address _safeWallet,
        address _boosterOwner,
        address _booster
    ) ExtraRewardStashModule(_owner, _safeWallet, _boosterOwner, _booster) {
        // all is done on the parent constructor
    }

    /**
     * @notice Set the extra reward token for a stash
     * @param pid: pool id
     * @param _token: address of the token
     * @dev Only callable by the keeper, only if the token is authorized
     */
    function setStashExtraReward(uint256 pid, address _token) external override onlyKeeper {
        address stash = _validateParameters(pid, _token);

        _execCallFromModule(
            boosterOwner,
            abi.encodeWithSignature("setStashExtraReward(address,address)", stash, _token)
        );
    }
}
