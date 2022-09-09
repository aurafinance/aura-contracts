// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { IrCvx } from "./interfaces/IrCvx.sol";
import { ILayerZeroEndpoint } from "./interfaces/ILayerZeroEndpoint.sol";
import { ILayerZeroReceiver } from "./interfaces/ILayerZeroReceiver.sol";

/**
 * @title SiphonReciever
 * @dev Takes rAURA deposits from rAURA on L1 and distributes them
 *      When rewardClaimed is called on the Booster
 */
contract SiphonReceiver is ILayerZeroReceiver, Ownable {
    using SafeERC20 for IrCvx;

    ILayerZeroEndpoint public lzEndpoint;
    address public l1SiphonDepositor;
    IrCvx public rCvx;
    address public booster;
    uint16 public immutable dstChainId;

    constructor(
        ILayerZeroEndpoint _lzEndpoint,
        address _l1SiphonDepositor,
        IrCvx _rCvx,
        uint16 _dstChainId
    ) {
        lzEndpoint = _lzEndpoint;
        l1SiphonDepositor = _l1SiphonDepositor;
        rCvx = _rCvx;
        dstChainId = _dstChainId;
    }

    function setBooster(address _booster) external onlyOwner {
        booster = _booster;
    }

    /**
     * @dev "Mint" function called by Booster.rewardClaimed. Sends rCvx
     *      to the defined address
     * @param _to     Address to send rCvx to
     * @param _amount Amount of rCvx to send
     */
    function mint(address _to, uint256 _amount) external {
        require(msg.sender == booster, "!booster");
        rCvx.safeTransfer(_to, _amount);
    }

    function queueNewRewards(uint256) external {
        // TODO:
        // Potential idea:
        // only callable by the Booster
        // Every 2nd call could trigger the incentives to be
        // sent back to the L1 (via lzEndpoint)
    }

    function convert(uint256 _amount, bool _lock) external payable {
        rCvx.burn(msg.sender, _amount);

        lzEndpoint.send{ value: msg.value }(
            dstChainId, // _dstChainId,
            abi.encodePacked(l1SiphonDepositor, address(this)), // _lzRemoteLookup[_dstChainId],
            bytes(abi.encode(msg.sender, _amount, _lock)), // _payload,
            payable(msg.sender), // _refundAddress,
            address(0), // _zroPaymentAddress,
            bytes("") // _adapterParams
        );
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
