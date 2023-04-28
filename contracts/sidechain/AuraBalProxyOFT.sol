// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { ProxyOFT } from "../layerzero/token/oft/extension/ProxyOFT.sol";
import { IGenericVault } from "../interfaces/IGenericVault.sol";
import { IVirtualRewards } from "../interfaces/IVirtualRewards.sol";
import { CrossChainConfig } from "./CrossChainConfig.sol";
import { IProxyOFT } from "../layerzero/token/oft/extension/IProxyOFT.sol";

/**
 * @title AuraBalProxyOFT
 * @dev   Send and receive auraBAL to and from all the sidechains.
 *        all auraBAL sat in this bridge will be staked in the auraBAL
 *        compounder and rewards distributed to the L2 staking contracts
 */
contract AuraBalProxyOFT is ProxyOFT, CrossChainConfig {
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

    /// @dev token address mapped to amount
    mapping(address => uint256) public totalClaimable;

    /// @dev token address mapped srcChainId mapped to amount claimable
    mapping(address => mapping(uint16 => uint256)) public claimable;

    /// @dev srcChainId mapped to reward receiver
    mapping(uint16 => address) public rewardReceiver;

    /// @dev Authorized harvesters
    mapping(address => bool) public authorizedHarvesters;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _lzEndpoint  LayerZero endpoint contract
     * @param _token       The proxied token (auraBAL)
     * @param _vault       AuraBal compounder vault
     */
    constructor(
        address _lzEndpoint,
        address _token,
        address _vault
    ) ProxyOFT(_lzEndpoint, _token) {
        vault = _vault;

        IERC20(_token).approve(_vault, type(uint256).max);
    }

    /* -------------------------------------------------------------------
       Setter functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Set cross chain config for selector
     * @param _srcChainId Source chain layer zero chainId
     * @param _selector The function selector
     * @param _config Config struct for adapterParams and zroPaymentAddress etc
     */
    function setConfig(
        uint16 _srcChainId,
        bytes4 _selector,
        Config memory _config
    ) external override onlyOwner {
        _setConfig(_srcChainId, _selector, _config);
    }

    function setRewardReceiver(uint16 _srcChainId, address _receiver) external onlyOwner {
        rewardReceiver[_srcChainId] = _receiver;
    }

    /// @notice Adds or remove an address from the harvesters' whitelist
    /// @param _harvester address of the authorized harvester
    /// @param _authorized Whether to add or remove harvester
    function updateAuthorizedHarvesters(address _harvester, bool _authorized) external onlyOwner {
        authorizedHarvesters[_harvester] = _authorized;
    }

    /* -------------------------------------------------------------------
       View functions 
    ------------------------------------------------------------------- */

    function circulatingSupply() public view override returns (uint256) {
        return innerToken.totalSupply() - internalTotalSupply;
    }

    /* -------------------------------------------------------------------
       Credit/Debit 
    ------------------------------------------------------------------- */

    /**
     * @dev Override debtFrom to include a stake call after
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
        _stakeAll();
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
     * @param _srcChainIds Array of source chain layer zero IDs
     * @param _totalUnderlying Array of totalUnderlying auraBAL staked on the source chain
     * @param _totalUnderlyingSum Sum of values in _totalUnderlying array
     */
    function harvest(
        uint16[] memory _srcChainIds,
        uint256[] memory _totalUnderlying,
        uint256 _totalUnderlyingSum
    ) external {
        require(authorizedHarvesters[msg.sender], "!harvester");

        uint256 srcChainIdsLen = _srcChainIds.length;
        require(srcChainIdsLen == _totalUnderlying.length, "!parity");

        HarvestToken[] memory harvestTokens = _processHarvestableTokens();

        // For each chain we are sending rewards to loop through the harvestable
        // tokens and add the proportional rewards to the claimable mapping
        //
        // Keep track of the sum of the totalUnderlying to verify the user input
        // _totalUnderlyingSum is correct
        uint256 accUnderlying = 0;
        uint256 harvestTokenslen = harvestTokens.length;
        for (uint256 i = 0; i < srcChainIdsLen; i++) {
            for (uint256 j = 0; j < harvestTokenslen; j++) {
                HarvestToken memory harvestToken = harvestTokens[j];
                uint256 amount = (harvestToken.rewards * _totalUnderlying[i]) / _totalUnderlyingSum;
                claimable[harvestToken.token][_srcChainIds[i]] += amount;
                totalClaimable[harvestToken.token] += amount;
            }
            accUnderlying += _totalUnderlying[i];
        }

        require(accUnderlying == _totalUnderlyingSum, "!totalUnderlyingSum");
    }

    /**
     * @dev Process claimable rewards
     * @param _token The token to process
     * @param _oft The ProxyOFT representation of the _token
     * @param _srcChainId The source chain ID
     */
    function processClaimable(
        address _token,
        address _oft,
        uint16 _srcChainId
    ) external payable {
        uint256 reward = claimable[_token][_srcChainId];
        address receiver = rewardReceiver[_srcChainId];
        require(receiver != address(0), "!receiver");
        require(reward > 0, "!reward");

        claimable[_token][_srcChainId] = 0;
        totalClaimable[_token] -= reward;

        if (_token == address(innerToken)) {
            require(_oft == address(this), "!oft");
            // The token is this inner token so we need to call the internal
            // bridge mint/burn functions rather than sendFrom
            _lzSend(
                _srcChainId,
                abi.encode(PT_SEND, abi.encodePacked(receiver), reward),
                payable(msg.sender),
                configs[_srcChainId][AuraBalProxyOFT.processClaimable.selector].zroPaymentAddress,
                configs[_srcChainId][AuraBalProxyOFT.processClaimable.selector].adapterParams,
                msg.value
            );

            internalTotalSupply += reward;

            emit SendToChain(_srcChainId, address(this), abi.encode(receiver), reward);
        } else {
            // The token is one that this contract holds a balance of eg $AURA
            // bridge it to the L2 via it's proxy OFT contracts
            IERC20(_token).approve(_oft, reward);
            IProxyOFT(_oft).sendFrom{ value: msg.value }(
                address(this),
                _srcChainId,
                abi.encodePacked(receiver),
                reward,
                payable(msg.sender),
                configs[_srcChainId][AuraBalProxyOFT.processClaimable.selector].zroPaymentAddress,
                configs[_srcChainId][AuraBalProxyOFT.processClaimable.selector].adapterParams
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
        return vault.call{ value: _value }(_data);
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
    function _stakeAll() internal {
        uint256 amount = innerToken.balanceOf(address(this));
        IGenericVault(vault).deposit(amount, address(this));
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
            address token = IVirtualRewards(extraRewards).rewardToken();
            IVirtualRewards(extraRewards).getReward();
            uint256 rewards = IERC20(token).balanceOf(address(this));
            harvestTokens[i + 1] = HarvestToken(token, rewards);
        }
    }
}
