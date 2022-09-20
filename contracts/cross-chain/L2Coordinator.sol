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

    /// @dev Booster contract
    address public booster;

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
     * @param _amount Amount of rCvx to send
     */
    function mint(address _to, uint256 _amount) external {
        require(msg.sender == booster, "!booster");
        _transfer(address(this), _to, _amount);
        emit Mint(msg.sender, _to, _amount);
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
}
