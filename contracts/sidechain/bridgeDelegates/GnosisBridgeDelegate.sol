// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";
import { BaseBridgeDelegate } from "./BaseBridgeDelegate.sol";

interface IGnosisBridge {
    function transferAndCall(
        address _to,
        uint256 _value,
        bytes memory _data
    ) external;
}

contract GnosisBridgeDelegate is BaseBridgeDelegate {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    // Todo: Make this a constructor argument
    address bridge = 0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _crv) BaseBridgeDelegate(_crv) {
        crv = _crv;
    }

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */

    function forwardBal(uint256 _amount) external onlyOwner {
        require(l1Delegate != address(0), "L1DelegateNotSet");
        bytes memory _data = abi.encode(address(l1Delegate));
        IGnosisBridge(bridge).transferAndCall(bridge, _amount, _data);
    }
}
