// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { AuraMinter } from "./AuraMinter.sol";

/**
 * @title   AuraMinterOwner
 * @notice  Wraps the AuraMinter mint function and protects from inflation with a cap
 *          of 3 million AURA per 52-week epoch.
 * @dev     This contract provides an additional layer of protection over the AuraMinter
 *          by implementing yearly minting caps. Ownership initially owned by the DAO.
 *          The contract tracks epochs starting from when the AuraMinter's inflation
 *          protection time expires.
 * @author  AuraFinance
 */
contract AuraMinterOwner is Ownable {
    /// @notice The AuraMinter contract that this contract wraps
    /// @dev This contract calls the mint function on the AuraMinter
    AuraMinter public immutable auraMinter;

    /// @notice Maximum AURA that can be minted per epoch/year (3 million with 18 decimals)
    /// @dev Each epoch allows up to 3 million AURA to be minted
    uint256 public constant EPOCH_CAP = 3_000_000 * 1e18;

    /// @notice Duration of each epoch in seconds (52 weeks)
    /// @dev Epochs are yearly periods during which EPOCH_CAP can be minted
    uint256 public constant EPOCH_DURATION = 52 weeks;

    /// @notice Total amount of AURA minted through this contract across all epochs
    /// @dev Tracks cumulative minting to enforce MAX_TOTAL_CAP
    uint256 public totalMinted;

    /// @notice Mapping of epoch number to total amount minted in that epoch
    /// @dev Tracks per-epoch minting to enforce EPOCH_CAP per period (no carryover)
    mapping(uint256 => uint256) public mintedByEpoch;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    /**
     * @notice Emitted when AURA tokens are minted through this contract
     * @param to The address that received the minted tokens
     * @param amount The amount of tokens minted
     * @param epoch The epoch in which the minting occurred
     */
    event AuraMinted(address indexed to, uint256 amount, uint256 epoch);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @notice Constructs the AuraMinterOwner contract
     * @dev Initializes the contract with the AuraMinter address and transfers ownership to the DAO
     * @param _auraMinter Address of the AuraMinter contract to wrap
     * @param _dao Address of the DAO that will own this contract
     */
    constructor(address _auraMinter, address _dao) Ownable() {
        auraMinter = AuraMinter(_auraMinter);
        _transferOwnership(_dao);
    }

    /**
     * @notice Calculates the current epoch number based on time elapsed since inflation protection ended
     * @dev Epochs start counting from 1 when the AuraMinter's inflation protection time expires.
     *      Each epoch lasts EPOCH_DURATION (52 weeks).
     * @return The current epoch number (starting from 1)
     */
    function _getCurrentEpoch() internal view returns (uint256) {
        if (block.timestamp <= auraMinter.inflationProtectionTime()) {
            return 0;
        }
        return ((block.timestamp - auraMinter.inflationProtectionTime()) / EPOCH_DURATION) + 1;
    }

    /* -------------------------------------------------------------------
       Core Functions 
    ------------------------------------------------------------------- */

    /**
     * @notice Mints AURA tokens with epoch-based caps only
     * @dev Only the owner can mint. Enforces yearly epoch caps (no carryover).
     *      Minting is only allowed after the AuraMinter's inflation protection period ends.
     * @param _to Address to receive the minted tokens
     * @param _amount Amount of AURA tokens to mint (in wei, 18 decimals)
     */
    function mint(address _to, uint256 _amount) external onlyOwner {
        require(_to != address(0), "Invalid recipient");
        require(_amount > 0, "Zero amount");
        require(block.timestamp >= auraMinter.inflationProtectionTime(), "Inflation protection active");

        uint256 currentEpoch = _getCurrentEpoch();
        uint256 currentEpochMinted = mintedByEpoch[currentEpoch];
        uint256 amountMintedAfter = currentEpochMinted + _amount;

        require(amountMintedAfter <= EPOCH_CAP, "Exceeds epoch cap");

        totalMinted += _amount;
        mintedByEpoch[currentEpoch] = amountMintedAfter;
        auraMinter.mint(_to, _amount);

        emit AuraMinted(_to, _amount, currentEpoch);
    }

    /* -------------------------------------------------------------------
       View Functions 
    ------------------------------------------------------------------- */

    /**
     * @notice Returns the amount of AURA tokens that can currently be minted
     * @dev Calculates mintable amount based on current epoch cap only (no carryover, no total cap)
     * @return mintable The amount of AURA tokens that can still be minted in current epoch
     */
    function getMintable() external view returns (uint256 mintable) {
        uint256 currentEpoch = _getCurrentEpoch();
        if (currentEpoch == 0) {
            mintable = 0;
        } else {
            uint256 currentEpochMinted = mintedByEpoch[currentEpoch];
            mintable = EPOCH_CAP - currentEpochMinted;
        }
    }

    /**
     * @notice Returns the current epoch number
     * @dev External view function to get the current epoch for transparency
     * @return The current epoch number (starting from 1)
     */
    function getCurrentEpoch() external view returns (uint256) {
        return _getCurrentEpoch();
    }
}
