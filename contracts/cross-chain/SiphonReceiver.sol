// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { IrCvx } from "../interfaces/IrCvx.sol";
import { ILayerZeroEndpoint } from "../interfaces/ILayerZeroEndpoint.sol";
import { ILayerZeroReceiver } from "../interfaces/ILayerZeroReceiver.sol";

/**
 * @title SiphonReciever
 * @dev Takes rAURA deposits from rAURA on L1 and distributes them
 *      When rewardClaimed is called on the Booster
 */
contract SiphonReceiver is ILayerZeroReceiver, Ownable {
    using SafeERC20 for IrCvx;

    /* -------------------------------------------------------------------
      Storage 
    ------------------------------------------------------------------- */

    /// @dev Booster contract
    address public booster;

    /// @dev rCVX contract
    IrCvx public rCvx;

    /// @dev Siphon depositor on L1
    address public l1SiphonDepositor;

    /// @dev Layer Zero endpoint
    ILayerZeroEndpoint public lzEndpoint;

    /// @dev Destination chain ID used by Layer Zero
    uint16 public immutable dstChainId;

    /* -------------------------------------------------------------------
      Events 
    ------------------------------------------------------------------- */

    event UpdateBooster(address sender, address booster);

    event Mint(address sender, address to, uint256 amount);

    event Convert(address sender, uint256 amount, bool lock);

    /* -------------------------------------------------------------------
      Constructor 
    ------------------------------------------------------------------- */

    constructor(
        IrCvx _rCvx,
        address _l1SiphonDepositor,
        ILayerZeroEndpoint _lzEndpoint,
        uint16 _dstChainId
    ) {
        lzEndpoint = _lzEndpoint;
        l1SiphonDepositor = _l1SiphonDepositor;
        rCvx = _rCvx;
        dstChainId = _dstChainId;
    }

    /* -------------------------------------------------------------------
      Setter functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Set the Booster address
     * @param _booster Booster address
     */
    function setBooster(address _booster) external onlyOwner {
        booster = _booster;
        emit UpdateBooster(msg.sender, _booster);
    }

    /* -------------------------------------------------------------------
      Core functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Mint function called by Booster.rewardClaimed. rCVX tokens are
     *      minted on the L1 chain and sent to this contract on the L2 chain
     *      when rewardClaimed is called on the booster rCVX tokens are sent
     *      to the sender.
     * @param _to     Address to send rCvx to
     * @param _amount Amount of rCvx to send
     */
    function mint(address _to, uint256 _amount) external {
        require(msg.sender == booster, "!booster");
        rCvx.safeTransfer(_to, _amount);
        emit Mint(msg.sender, _to, _amount);
    }

    function queueNewRewards(uint256) external {
        // TODO:
        // Potential idea:
        // only callable by the Booster
        // Every 2nd call could trigger the incentives to be
        // sent back to the L1 (via lzEndpoint)
    }

    /* -------------------------------------------------------------------
      LZ functions L2 -> L1
    ------------------------------------------------------------------- */

    /**
     * @dev Convert L2 rCVX tokens to CVX tokens on L1 via Layer Zero
     * @param _amount Amount of rCVX tokens to convert
     * @param _lock   If the received CVX tokens should be locked on L1
     */
    function convert(uint256 _amount, bool _lock) external payable {
        rCvx.burn(msg.sender, _amount);

        lzEndpoint.send{ value: msg.value }(
            // destination chain
            dstChainId,
            // remote address packed with local address
            abi.encodePacked(l1SiphonDepositor, address(this)),
            // payload
            bytes(abi.encode(msg.sender, _amount, _lock)),
            // refund address
            payable(msg.sender),
            // ZRO payment address,
            address(0),
            // adapter params
            bytes("")
        );

        emit Convert(msg.sender, _amount, _lock);
    }

    /**
     * @dev LZ Receive function
     *      L1 calls this contract with an amount of rCVX tokens to mint
     * @param _srcChainId The source chain ID this transaction came from
     * @param _srcAddress The source address that sent this transaction
     * @param _nonce      Number used once
     * @param _payload    The transaction payload
     */
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
