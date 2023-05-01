// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";
import { IERC677 } from "../../interfaces/IERC677.sol";

contract GnosisBridgeSender is BridgeDelegateSender {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    address public immutable bridge;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _bridge, address _crv) {
        bridge = _bridge;
        crv = _crv;
    }

    /* -------------------------------------------------------------------
       Functions
    ------------------------------------------------------------------- */

    /// _to not in use. Currently forwards to the 'l1Delegate'
    function send(uint256 _amount) external override onlyOwner {
        require(l1Receiver != address(0), "L1ReceiverNotSet");
        bytes memory data = abi.encodePacked(address(l1Receiver));
        IERC677(crv).transferAndCall(bridge, _amount, data);
        emit Send(l1Receiver, _amount);
    }
}
