// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ProxyOFT } from "../layerzero/token/oft/extension/ProxyOFT.sol";
import { PauseGaurdian } from "./PauseGuardian.sol";

/**
 * @title PausableProxyOFT
 */
contract PausableProxyOFT is ProxyOFT, PauseGaurdian {
    constructor(
        address _lzEndpoint,
        address _token,
        address _gaurdian
    ) ProxyOFT(_lzEndpoint, _token) PauseGaurdian(_gaurdian) {}

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
        // TODO: track net outflows
        super.sendFrom(_from, _dstChainId, _toAddress, _amount, _refundAddress, _zroPaymentAddress, _adapterParams);
    }

    // TODO: track net inflows

    // TODO: some sort of queue logic... override _sendAck??
}
