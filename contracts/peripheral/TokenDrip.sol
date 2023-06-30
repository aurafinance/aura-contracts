// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

/**
 * @author Aura Finance
 * @title TokenDrip
 * @dev Drip tokens to an address based on a rate per second
 */
contract TokenDrip is Ownable {
    using AuraMath for uint256;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev The token to send to the address
    address public immutable token;

    /// @dev The address to send the tokens to
    address public immutable to;

    /// @dev The last time the drip was called/updated
    uint256 public lastUpdated;

    /// @dev Current accumulated dripped value
    uint256 public current;

    /// @dev Target total dripped amount
    uint256 public target;

    /// @dev The rate per second of the drip
    uint256 public rate;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    event UpdateDrip(uint256 lastUpdated, uint256 current, uint256 target, uint256 rate);
    event Drip(uint256 amount);
    event Cancel(uint256 lastUpdated, uint256 current, uint256 target, uint256 rate);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _token    The token address
     * @param _to       The address to drip to
     * @param _target   The target amount to drip in total
     * @param _rate     The rate per second to drip tokens
     */
    constructor(
        address _token,
        address _to,
        uint256 _target,
        uint256 _rate
    ) {
        token = _token;
        to = _to;

        _updateDrip(block.timestamp, 0, _target, _rate);
    }

    /* -------------------------------------------------------------------
       Core 
    ------------------------------------------------------------------- */

    /**
     * @dev Drip token on the schedule
     */
    function drip() external {
        require(target != 0, "!drip");

        // get the amount of time past since the last drip and calculate how
        // many tokens can be dripped based on the current rate
        uint256 delta = block.timestamp.sub(lastUpdated);
        uint256 amount = delta.mul(rate);
        uint256 newCurrent = current.add(amount);

        // If the newly calculated current amount is greater than the target
        // then recalculate the amount as the difference between the target
        // and the current value.
        if (newCurrent > target) {
            amount = target.sub(current);
            // Update the new current value based on the amount
            newCurrent = current.add(amount);
        }

        require(amount != 0, "!amount");

        // Update storage
        current = newCurrent;
        lastUpdated = block.timestamp;

        IERC20(token).transfer(to, amount);

        emit Drip(amount);
    }

    /**
     * @dev Update the drip configuration
     * @param _lastUpdated  The last updated time
     * @param _current      The current value that has been dripped
     * @param _target       The target amount to drip in total
     * @param _rate         The rate per second to drip tokens
     */
    function update(
        uint256 _lastUpdated,
        uint256 _current,
        uint256 _target,
        uint256 _rate
    ) external onlyOwner {
        _updateDrip(_lastUpdated, _current, _target, _rate);
    }

    /**
     * @dev Cancel the current drip
     */
    function cancel() external onlyOwner {
        _updateDrip(0, 0, 0, 0);

        emit Cancel(lastUpdated, current, target, rate);
    }

    /**
     * @dev Withdraw ERC20 tokens
     * @param _token    The token address to withdraw
     * @param _to       The address to send the tokens to
     * @param _amount   The amount of tokens to send
     */
    function withdrawERC20(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyOwner {
        IERC20(_token).transfer(_to, _amount);
    }

    /* -------------------------------------------------------------------
       Internal 
    ------------------------------------------------------------------- */

    /**
     * @dev Update the drip configuration
     * @param _lastUpdated  The last updated time
     * @param _current      The current value that has been dripped
     * @param _target       The target amount to drip in total
     * @param _rate         The rate per second to drip tokens
     */
    function _updateDrip(
        uint256 _lastUpdated,
        uint256 _current,
        uint256 _target,
        uint256 _rate
    ) internal {
        lastUpdated = _lastUpdated;
        current = _current;
        target = _target;
        rate = _rate;
        emit UpdateDrip(_lastUpdated, _current, _target, _rate);
    }
}
