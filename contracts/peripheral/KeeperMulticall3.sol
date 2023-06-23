// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { Multicall3 } from "./Multicall3.sol";

/**
 *  @title KeeperMulticall3
 *  @notice Aggregate results from multiple function calls
 *  @dev Aggregate methods are marked `payable` to save 24 gas per call
 *  @author Aura Finance
 */
contract KeeperMulticall3 is Multicall3, Ownable {
    using SafeERC20 for IERC20;

    mapping(address => bool) public authorizedKeepers;

    constructor(address _owner) {
        _transferOwnership(_owner);
    }

    /// @notice Adds or remove an address from the harvesters' whitelist
    /// @param _harvester address of the authorized harvester
    /// @param _authorized Whether to add or remove harvester
    function updateAuthorizedKeepers(address _harvester, bool _authorized) external onlyOwner {
        authorizedKeepers[_harvester] = _authorized;
    }

    /* -------------------------------------------------------------------
       Modifiers 
    ------------------------------------------------------------------- */

    modifier onlyKeeper() {
        require(authorizedKeepers[msg.sender], "!keeper");
        _;
    }

    /// @notice Aggregate calls, ensuring each returns success if required
    /// @param calls An array of Call3 structs
    /// @return returnData An array of Result structs
    function aggregate3(Call3[] calldata calls)
        public
        payable
        virtual
        override
        onlyKeeper
        returns (Result[] memory returnData)
    {
        return super.aggregate3(calls);
    }

    /// @notice Aggregate calls with a msg value
    /// @notice Reverts if msg.value is less than the sum of the call values
    /// @param calls An array of Call3Value structs
    /// @return returnData An array of Result structs
    function aggregate3Value(Call3Value[] calldata calls)
        public
        payable
        virtual
        override
        onlyKeeper
        returns (Result[] memory returnData)
    {
        return super.aggregate3Value(calls);
    }

    /// @notice Aggregate calls with a msg value previously funded
    /// @notice It requires to fund this contract previous to any call.
    /// @param calls An array of Call3Value structs
    /// @return returnData An array of Result structs
    function aggregate3Funded(Call3Value[] calldata calls)
        public
        payable
        virtual
        override
        onlyKeeper
        returns (Result[] memory returnData)
    {
        return super.aggregate3Funded(calls);
    }

    function recoverEthBalance() external onlyOwner {
        address addr = address(this);
        (bool sent, ) = payable(owner()).call{ value: getEthBalance(addr) }("");
        require(sent, "!refund");
    }

    function recoverERC20(address _tokenAddress, uint256 _tokenAmount) external onlyOwner {
        IERC20(_tokenAddress).safeTransfer(owner(), _tokenAmount);
    }
}
