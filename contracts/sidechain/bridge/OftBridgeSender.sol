// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";
import { IOFT } from "../../layerzero/token/oft/IOFT.sol";

contract OftBridgeSender is BridgeDelegateSender {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev Crv OFT address
    address public immutable crvOft;

    /// @dev The canonical chain ID
    uint16 public immutable canonicalChainId;

    /// @dev Send from adapterParams
    bytes public adapterParams;

    event SetAdapterParams(bytes adapterParams);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _crvOft The L2 oft token address.
     * @param _canonicalChainId The canonical chain ID
     */
    constructor(address _crvOft, uint16 _canonicalChainId) {
        crvOft = _crvOft;
        canonicalChainId = _canonicalChainId;
    }

    /**
     * @dev Set adapter params
     * @param _adapterParams Adapter params
     */
    function setAdapterParams(bytes memory _adapterParams) external onlyOwner {
        adapterParams = _adapterParams;
        emit SetAdapterParams(_adapterParams);
    }

    /* -------------------------------------------------------------------
       Functions
    ------------------------------------------------------------------- */

    function send(uint256 _amount) external override {
        // silence is golden
    }

    /**
     * @dev Function to send a specified amount of tokens.
     * @param _amount The amount of CRV tokens to be sent
     */
    function sendFrom(uint256 _amount) external payable onlyKeeper {
        IOFT(crvOft).sendFrom{ value: address(this).balance }(
            address(this),
            canonicalChainId,
            abi.encodePacked(l1Receiver),
            _amount,
            payable(msg.sender),
            address(0),
            adapterParams
        );
        emit Send(l1Receiver, _amount);
    }
}
