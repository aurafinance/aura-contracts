// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { OFT } from "../layerzero/token/oft/OFT.sol";
import { PauseGuardian } from "./PauseGuardian.sol";

/**
 * @title PausableOFT
 * @author AuraFinance
 * @notice Extension to the OFT standard that allows a `guardian` address to perform an emergency pause
 *  on the `sendFrom` function.
 */
contract PausableOFT is OFT, PauseGuardian {
    /**
     * @dev Constructs the PausableOFT contract
     * @param _name       The oft token name
     * @param _symbol     The oft token symbol
     */
    constructor(string memory _name, string memory _symbol) OFT(_name, _symbol) {}

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
