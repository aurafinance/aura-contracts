// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { IrCvx } from "../interfaces/IrCvx.sol";
import { OFT } from "./layer-zero/token/oft/OFT.sol";

/**
 * @title L2Coordinator
 * @dev Takes rAURA deposits from rAURA on L1 and distributes them
 *      When rewardClaimed is called on the Booster
 */
contract L2Coordinator is OFT {
    using SafeERC20 for IrCvx;

    /* -------------------------------------------------------------------
      Storage 
    ------------------------------------------------------------------- */

    // Scale multiplier
    uint256 internal constant WAD = 10**18;

    /// @dev Booster contract
    address public booster;

    /// @dev Rate to send CVX on mint
    uint256 public mintRate;

    /* -------------------------------------------------------------------
      Events 
    ------------------------------------------------------------------- */

    event UpdateBooster(address sender, address booster);

    event Mint(address sender, address to, uint256 amount);

    /* -------------------------------------------------------------------
      Constructor 
    ------------------------------------------------------------------- */

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint
    ) OFT(_name, _symbol, _lzEndpoint) {}

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
     * @param _amount Amount of CRV rewardClaimed was called with
     */
    function mint(address _to, uint256 _amount) external {
        require(msg.sender == booster, "!booster");
        uint256 amount = (_amount * mintRate) / WAD;
        _transfer(address(this), _to, amount);
        emit Mint(msg.sender, _to, amount);
    }

    /* -------------------------------------------------------------------
      LZ functions L2 -> L1
    ------------------------------------------------------------------- */

    /**
     * @dev Send BAL rewards tokens from L2 to L1
     */
    function flush() external onlyOwner {
        // TODO:
        // Send BAL from L2 -> L1. We may want to consider making this
        // functionality upgradable. If a bridge stop supporting BAL
        // or liquidity dries up we could end up stuck. We could also
        // consider writing a fallback to the native bridge
    }

    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal virtual override {
        if (_payload.length > 128) {
            // The length of the payload is greater than the length of abi.encode(addressBytes, amount)
            // which is always 128 so we can assume this call is being sent from SiphonDepositor.siphon
            // which also sends the CRV:CVX reward rate as a third encoded paramater.
            (bytes memory a, uint256 cvxAmount, uint256 crvAmount) = abi.decode(_payload, (bytes, uint256, uint256));
            mintRate = (cvxAmount * WAD) / crvAmount;
            // Continue with LZ flow with crvAmount removed from payload
            _payload = abi.encode(a, cvxAmount);
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        } else {
            // Continue with the normal flow for an OFT transfer
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
}
