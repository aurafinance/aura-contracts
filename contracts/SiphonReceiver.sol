// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

import { IrCvx } from "./interfaces/IrCvx.sol";
import { ILayerZeroEndpoint } from "./interfaces/ILayerZeroEndpoint.sol";
import { ILayerZeroReceiver } from "./interfaces/ILayerZeroReceiver.sol";

/**
 * @title SiphonReciever
 * @dev Takes rAURA deposits from rAURA on L1 and distributes them
 *      When rewardClaimed is called on the Booster
 */
contract SiphonReceiver is ILayerZeroReceiver {
    ILayerZeroEndpoint public lzEndpoint;
    address public l1SiphonDepositor;
    IrCvx public rCvx;

    constructor(
        ILayerZeroEndpoint _lzEndpoint,
        address _l1SiphonDepositor,
        IrCvx _rCvx
    ) {
        lzEndpoint = _lzEndpoint;
        l1SiphonDepositor = _l1SiphonDepositor;
        rCvx = _rCvx;
    }

    function mint(address, uint256) external {
        // TODO: transfer rAura to caller
        // Only callable by the Boosters rewardClaimed
    }

    function queueNewRewards(uint256) external {
        // TODO:
        // Potential idea:
        // only callable by the Booster
        // Every 2nd call could trigger the incentives to be
        // sent back to the L1 (via lzEndpoint)
    }

    function convert(uint256 _amount, bool _lock) external {
        // TODO:
        // Calls L1 SiphonDepositor convert function (via lzEndpoint)
    }

    function lzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes calldata _payload
    ) external {
        require(msg.sender == address(lzEndpoint), "!lzEndpoint");
        require(keccak256(_srcAddress) == keccak256(abi.encodePacked(l1SiphonDepositor)), "!srcAddress");

        uint256 rCvxAmount = abi.decode(_payload, (uint256));
        rCvx.mint(address(this), rCvxAmount);
    }
}
