// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";
import { IERC677 } from "../../interfaces/IERC677.sol";

contract GnosisBridgeSender is BridgeDelegateSender {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */
    /// @dev The Gnosis bridge address
    address public immutable bridge;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */
    /**
     * @dev Constructs the GnosisBridgeSender contract.
     * @param _bridge The gnosis bridge address.
     * @param _crv The ERC677 token address.
     */
    constructor(address _bridge, address _crv) {
        bridge = _bridge;
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
        bytes memory data = abi.encodePacked(address(l1Receiver));
        IERC677(crv).transferAndCall(bridge, _amount, data);
        emit Send(l1Receiver, _amount);
    }
}
