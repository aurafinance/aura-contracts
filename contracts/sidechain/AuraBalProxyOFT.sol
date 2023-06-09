// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IGenericVault } from "../interfaces/IGenericVault.sol";
import { IVirtualRewards } from "../interfaces/IVirtualRewards.sol";
import { CrossChainConfig } from "./CrossChainConfig.sol";
import { PausableProxyOFT } from "./PausableProxyOFT.sol";
import { IProxyOFT } from "../layerzero/token/oft/extension/IProxyOFT.sol";
import { AuraMath } from "../utils/AuraMath.sol";

/**
 * @title AuraBalProxyOFT
 * @author AuraFinance
 * @dev   Send and receive auraBAL to and from all the sidechains.
 *        all auraBAL sat in this bridge will be staked in the auraBAL
 *        compounder and rewards distributed to the L2 staking contracts
 */
contract AuraBalProxyOFT is PausableProxyOFT, CrossChainConfig, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using AuraMath for uint256;

    /* -------------------------------------------------------------------
       Types 
    ------------------------------------------------------------------- */

    struct HarvestToken {
        address token;
        uint256 rewards;
    }

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev auraBAL compounder vault contract address
    address public vault;

    /// @dev Internally tracking of total auraBAL supply bridged
    uint256 public internalTotalSupply;

    /// @dev Harvest src chain IDs array
    uint16[] public harvestSrcChainIds;

    /// @dev token address mapped to amount
    mapping(address => uint256) public totalClaimable;

    /// @dev token address mapped srcChainId mapped to amount claimable
    mapping(address => mapping(uint16 => uint256)) public claimable;

    /// @dev srcChainId mapped to reward receiver
    mapping(uint16 => address) public rewardReceiver;

    /// @dev Authorized harvesters
    mapping(address => bool) public authorizedHarvesters;

    /// @dev Token to OFT
    mapping(address => address) public ofts;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    /**
     * @dev Emitted when harvest rewards.
     * @param caller The caller
     * @param totalUnderlyingSum The total amount of auraBal staked on all sidechains.
     */
    event Harvest(address indexed caller, uint256 totalUnderlyingSum);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @dev Constructs the AuraBalProxyOFT contract
     * @param _lzEndpoint   LayerZero endpoint contract
     * @param _token        The proxied token (auraBAL)
     * @param _vault        The AuraBal compounder vault
     * @param _guardian     The pause guardian address
     * @param _sudo         The super user address
     * @param _inflowLimit  Initial inflow limit per epoch
     */
    constructor(
        address _lzEndpoint,
        address _token,
        address _vault,
        address _guardian,
        address _sudo,
        uint256 _inflowLimit
    ) PausableProxyOFT(_token, _sudo, _inflowLimit) {
        vault = _vault;

        _initializeLzApp(_lzEndpoint);
        _initializePauseGuardian(_guardian);

        IERC20(_token).safeApprove(_vault, type(uint256).max);
    }

    /* -------------------------------------------------------------------
       Setter functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Sets the configuration for a given source chain ID and selector.
     * @param _srcChainId The source chain ID.
     * @param _selector The selector.
     * @param _adapterParams The adapter params.
     */
    function setAdapterParams(
        uint16 _srcChainId,
        bytes32 _selector,
        bytes memory _adapterParams
    ) external override onlyOwner {
        _setAdapterParams(_srcChainId, _selector, _adapterParams);
    }

    /**
     * @dev Set reward receiver for src chain
     * @param _srcChainId The source chain ID
     * @param _receiver The receiver address
     */
    function setRewardReceiver(uint16 _srcChainId, address _receiver) external onlyOwner {
        rewardReceiver[_srcChainId] = _receiver;
    }

    /**
     * @dev Adds or remove an address from the harvesters' whitelist
     * @param _harvester address of the authorized harvester
     * @param _authorized Whether to add or remove harvester
     */
    function updateAuthorizedHarvesters(address _harvester, bool _authorized) external onlyOwner {
        authorizedHarvesters[_harvester] = _authorized;
    }

    /**
     * @dev Set OFT for token
     * @param _token Token contract address
     * @param _oft OFT contract address
     */
    function setOFT(address _token, address _oft) external onlyOwner {
        ofts[_token] = _oft;
    }

    /**
     * @dev Set srcChainIds to loop through for harvest
     * @param _srcChainIds Source chain IDs
     */
    function setHarvestSrcChainIds(uint16[] memory _srcChainIds) external onlyOwner {
        delete harvestSrcChainIds;

        uint256 len = _srcChainIds.length;
        for (uint256 i = 0; i < len; i++) {
            harvestSrcChainIds.push(_srcChainIds[i]);
        }
    }

    /* -------------------------------------------------------------------
       View functions 
    ------------------------------------------------------------------- */

    /**
     * @dev returns the circulating amount of tokens on current chain
     */
    function circulatingSupply() public view override returns (uint256) {
        return innerToken.totalSupply() - internalTotalSupply;
    }

    /* -------------------------------------------------------------------
       Credit/Debit 
    ------------------------------------------------------------------- */

    /**
     * @dev Override debitFrom to include a stake call after
     * @param _from From address
     * @param _srcChainId Source chain ID
     * @param _toAddress Address to send to
     * @param _amount Amount to send
     */
    function _debitFrom(
        address _from,
        uint16 _srcChainId,
        bytes memory _toAddress,
        uint256 _amount
    ) internal override returns (uint256) {
        uint256 amount = super._debitFrom(_from, _srcChainId, _toAddress, _amount);
        amount = _stakeAll();
        internalTotalSupply += amount;
        return amount;
    }

    /**
     * @dev Override _creditTo to include a withdraw from vault before
     * @param _srcChainId Source chain ID
     * @param _toAddress Address to credit to
     * @param _amount Amount to credit
     */
    function _creditTo(
        uint16 _srcChainId,
        address _toAddress,
        uint256 _amount
    ) internal override returns (uint256) {
        _withdraw(_amount);
        uint256 amount = super._creditTo(_srcChainId, _toAddress, _amount);
        internalTotalSupply -= amount;
        return amount;
    }

    /* -------------------------------------------------------------------
       Harvest Rewards 
    ------------------------------------------------------------------- */

    /**
     * @dev Harvest rewards from the compounder and distribute them to the source chains
     *
     *      Collect the amount of auraBAL that is staked on each source chain (L2). Then
     *      trigger a harvest on the vault which calculates the amount of auraBAL that has
     *      been earned since the last claim and the amount of extra rewards. These rewards
     *      are then lazily distributed to the src chains proportionally.
     *
     *      Lazily meaning the claimable values are just added to a claimable mapping for
     *      processing latest via processClaimable
     *
     * @param _totalUnderlying Array of totalUnderlying auraBAL staked on the source chain
     * @param _totalUnderlyingSum Sum of values in _totalUnderlying array
     */
    function harvest(uint256[] memory _totalUnderlying, uint256 _totalUnderlyingSum) external {
        require(authorizedHarvesters[msg.sender], "!harvester");

        uint256 srcChainIdsLen = harvestSrcChainIds.length;
        require(srcChainIdsLen == _totalUnderlying.length, "!parity");

        HarvestToken[] memory harvestTokens = _processHarvestableTokens();

        // For each chain we are sending rewards to loop through the harvestable
        // tokens and add the proportional rewards to the claimable mapping
        //
        // Keep track of the sum of the totalUnderlying to verify the user input
        // _totalUnderlyingSum is correct
        uint256 harvestTokenslen = harvestTokens.length;
        for (uint256 j = 0; j < harvestTokenslen; j++) {
            HarvestToken memory harvestToken = harvestTokens[j];
            uint256 totalHarvested = 0;
            uint256 accUnderlying = 0;

            for (uint256 i = 0; i < srcChainIdsLen; i++) {
                uint256 totalUnderlying = _totalUnderlying[i];
                uint256 amount = harvestToken.rewards.mul(totalUnderlying).div(_totalUnderlyingSum);

                totalHarvested += amount;
                accUnderlying += totalUnderlying;

                claimable[harvestToken.token][harvestSrcChainIds[i]] += amount;
            }

            totalClaimable[harvestToken.token] += totalHarvested;

            if (j + 1 == harvestTokenslen) {
                // We only need to emit this event and run this require
                // at the end of the last loop as it is the same for each
                require(accUnderlying == _totalUnderlyingSum, "!sum");
                emit Harvest(msg.sender, _totalUnderlyingSum);
            }
        }
    }

    /**
     * @dev Process claimable rewards
     * @param _token The token to process
     * @param _srcChainId The source chain ID
     * @param _zroPaymentAddress The LayerZero ZRO payment address
     */
    function processClaimable(
        address _token,
        uint16 _srcChainId,
        address _zroPaymentAddress
    ) external payable whenNotPaused nonReentrant {
        address receiver = rewardReceiver[_srcChainId];
        uint256 reward = claimable[_token][_srcChainId];
        address oft = ofts[_token];

        require(receiver != address(0), "0");
        require(reward > 0, "!reward");
        require(oft != address(0), "!oft");

        claimable[_token][_srcChainId] = 0;
        totalClaimable[_token] -= reward;

        bytes memory adapterParams = getAdapterParams[_srcChainId][
            keccak256(
                abi.encodeWithSignature("processClaimable(address,uint16,address)", _token, _srcChainId, address(0))
            )
        ];

        if (_token == address(innerToken)) {
            require(oft == address(this), "!oft");
            // The token is this inner token so we need to call the internal
            // bridge mint/burn functions rather than sendFrom
            internalTotalSupply += reward;
            _lzSend(
                _srcChainId,
                abi.encode(PT_SEND, abi.encodePacked(receiver), reward),
                payable(msg.sender),
                _zroPaymentAddress,
                adapterParams,
                msg.value
            );

            emit SendToChain(_srcChainId, address(this), abi.encode(receiver), reward);
        } else {
            // The token is one that this contract holds a balance of eg $AURA
            // bridge it to the L2 via it's proxy OFT contracts
            IERC20(_token).safeIncreaseAllowance(oft, reward);
            IProxyOFT(oft).sendFrom{ value: msg.value }(
                address(this),
                _srcChainId,
                abi.encodePacked(receiver),
                reward,
                payable(msg.sender),
                _zroPaymentAddress,
                adapterParams
            );
        }
    }

    /* -------------------------------------------------------------------
      Vault Wrapper 
    ------------------------------------------------------------------- */

    /**
     * @notice Execute a function on the vault
     * @dev    In order to account for the withdrawalPenalty this contract needs
     *         To be the owner of the auraBAL vault. Therefore it needs to be
     *         able to call vault owner functions. Rather than wrapping each
     *         function we can just use an execute pointing at the vault
     */
    function vaultExecute(uint256 _value, bytes calldata _data) external onlyOwner returns (bool, bytes memory) {
        (bool success, bytes memory result) = vault.call{ value: _value }(_data);
        require(success, "!success");

        return (success, result);
    }

    /* -------------------------------------------------------------------
      Overrides 
    ------------------------------------------------------------------- */

    /**
     * @notice Rescues the specified amount of tokens from the bridge and transfers them to the specified address.
     * @dev This function is only callable by the sudo address.
     * @param _token The address of the token to be rescued.
     * @param _to The address to which the tokens should be transferred.
     * @param _amount The amount of tokens to be rescued.
     */
    function rescue(
        address _token,
        address _to,
        uint256 _amount
    ) external override {
        require(msg.sender == sudo, "!sudo");

        // Adjust the internalTotalSupply. This means we have to harvest and process
        // any rewards if we want to rescue the entire underlyingBalance of the bridge
        // otherwise this will underflow
        if (_token == address(innerToken)) {
            internalTotalSupply -= _amount;
            _withdraw(_amount);
        }

        IERC20(_token).safeTransfer(_to, _amount);
    }

    /* -------------------------------------------------------------------
      Internal 
    ------------------------------------------------------------------- */

    /**
     * @dev Withdraw from the vault
     * @param amount Amount to withdraw
     */
    function _withdraw(uint256 amount) internal {
        // Cache withdrawalPenalty so we can reset it
        uint256 withdrawalPenalty = IGenericVault(vault).withdrawalPenalty();
        IGenericVault(vault).setWithdrawalPenalty(0);
        // Process withdraw with 0 penalty
        uint256 withdrawn = IGenericVault(vault).withdraw(amount, address(this), address(this));
        // reset withdrawalPenalty
        IGenericVault(vault).setWithdrawalPenalty(withdrawalPenalty);
        require(withdrawn >= amount, "!withdrawn");
    }

    /**
     * @dev Stake all auraBAL in vault
     */
    function _stakeAll() internal returns (uint256) {
        uint256 amount = innerToken.balanceOf(address(this));
        IGenericVault(vault).deposit(amount, address(this));
        return amount;
    }

    /**
     * @dev Process harvestable tokens
     *      Grabs the amount of rewards for each reward token and returns an array of harvestTokens
     */
    function _processHarvestableTokens() internal returns (HarvestToken[] memory harvestTokens) {
        // Set up an array to contain all the tokens that need to be harvested
        // this will be all the extra rewards tokens and auraBAL
        uint256 extraRewardsLength = IGenericVault(vault).extraRewardsLength();
        harvestTokens = new HarvestToken[](extraRewardsLength + 1);

        // Add auraBAL as the first reward token to be harvested
        //
        // To calculate rewards we need to know the delta between auraBAL on the sidechains
        // and the auraBAL available on this bridge contract.
        //
        // - internalTotalSupply: auraBAL supply transferred to L2s
        // - underlyingBalance:   auraBAL balance of the bridge in the vault
        // - totalClaimable:      auraBAL that is claimable since the last harvest
        uint256 underlyingBalance = IGenericVault(vault).balanceOfUnderlying(address(this));
        uint256 rewards = underlyingBalance - internalTotalSupply - totalClaimable[address(innerToken)];
        harvestTokens[0] = HarvestToken(address(innerToken), rewards);

        // Loop through the extra reward token on the vault and add them to the
        // harvestTokens array for processing
        for (uint256 i = 0; i < extraRewardsLength; i++) {
            address extraRewards = IGenericVault(vault).extraRewards(i);
            address rewardToken = IVirtualRewards(extraRewards).rewardToken();
            IVirtualRewards(extraRewards).getReward();
            uint256 balance = IERC20(rewardToken).balanceOf(address(this));
            // Part of the balance is sat in the contract waiting to be claimable.
            // Subtract that from the current balance to get the newly harvested rewards
            uint256 rewardAmount = balance.sub(totalClaimable[rewardToken]);
            harvestTokens[i + 1] = HarvestToken(rewardToken, rewardAmount);
        }
    }
}
