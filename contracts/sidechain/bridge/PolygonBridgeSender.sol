// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";

interface IPolygonBridge {
    function withdraw(uint256 _amount) external;
}

contract PolygonBridgeSender is BridgeDelegateSender {
    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @dev Constructs the PolygonBridgeSender contract.
     * @param _crv The native token address.
     */
    constructor(address _crv) {
        crv = _crv;
    }

    /* -------------------------------------------------------------------
       Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Function to send a specified amount of tokens.
     * Requirements:
     * - The caller must be the owner of the contract.
     * @param _amount The amount of tokens to be sent
     */
    function send(uint256 _amount) external override onlyOwner {
        require(l1Receiver != address(0), "L1ReceiverNotSet");
        IPolygonBridge(crv).withdraw(_amount);
        emit Send(l1Receiver, _amount);
    }
}
