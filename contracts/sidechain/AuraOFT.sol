// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { PausableOFT } from "./PausableOFT.sol";
import { CrossChainConfig } from "./CrossChainConfig.sol";
import { CrossChainMessages as CCM } from "./CrossChainMessages.sol";

/**
 * @title   AuraOFT
 * @author  AuraFinance
 * @dev     Sidechain AURA
 */
contract AuraOFT is PausableOFT, CrossChainConfig {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev canonical chain ID
    uint16 public immutable canonicalChainId;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _gaurdian,
        uint16 _canonicalChainId
    ) PausableOFT(_name, _symbol, _lzEndpoint, _gaurdian) {
        canonicalChainId = _canonicalChainId;
    }

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */

    function setConfig(
        uint16 _srcChainId,
        bytes4 _selector,
        Config memory _config
    ) external override onlyOwner {
        _setConfig(_srcChainId, _selector, _config);
    }

    /* -------------------------------------------------------------------
       Core Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Lock CVX on the L1 chain
     * @param _cvxAmount Amount of CVX to lock for vlCVX on L1
     */
    function lock(uint256 _cvxAmount) external payable {
        require(_cvxAmount > 0, "!amount");
        _debitFrom(msg.sender, canonicalChainId, bytes(""), _cvxAmount);

        bytes memory payload = CCM.encodeLock(msg.sender, _cvxAmount);

        CrossChainConfig.Config memory config = configs[canonicalChainId][AuraOFT.lock.selector];

        _lzSend(
            canonicalChainId, ////////// Parent chain ID
            payload, /////////////////// Payload
            payable(msg.sender), /////// Refund address
            config.zroPaymentAddress, // ZRO payment address
            config.adapterParams, ////// Adapter params
            msg.value ////////////////// Native fee
        );
    }
}
