// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { OFT } from "../layerzero/token/oft/OFT.sol";
import { PauseGuardian } from "./PauseGuardian.sol";

/**
 * @title PausableOFT
 * @dev Sidechain AURA
 */
contract PausableOFT is OFT, PauseGuardian {
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _guardian
    ) OFT(_name, _symbol, _lzEndpoint) PauseGuardian(_guardian) {}

    /**
     * @dev Override sendFrom to add pause modifier
     */
    function sendFrom(
        address _from,
        uint16 _dstChainId,
        bytes calldata _toAddress,
        uint256 _amount,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) public payable override whenNotPaused {
        super.sendFrom(_from, _dstChainId, _toAddress, _amount, _refundAddress, _zroPaymentAddress, _adapterParams);
    }
}
