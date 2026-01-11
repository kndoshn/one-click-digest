"use strict";
var AS;
(function (AS) {
    let StateMachine;
    (function (StateMachine) {
        function initialState(language, mode) {
            return {
                phase: 'IDLE',
                selectedLanguage: language,
                selectedMode: mode,
                apiKeySet: false
            };
        }
        StateMachine.initialState = initialState;
        function reduce(state, event) {
            switch (event.type) {
                case 'BOOTSTRAP': {
                    return {
                        ...initialState(event.language, event.mode),
                        banner: state.banner
                    };
                }
                case 'SETTINGS_LOADED': {
                    return { ...state, apiKeySet: event.apiKeySet };
                }
                case 'LANGUAGE_CHANGED': {
                    return { ...state, selectedLanguage: event.language };
                }
                case 'MODE_CHANGED': {
                    return { ...state, selectedMode: event.mode };
                }
                case 'START_RUN': {
                    return {
                        phase: 'EXTRACTING',
                        runId: event.runId,
                        selectedLanguage: state.selectedLanguage,
                        selectedMode: state.selectedMode,
                        apiKeySet: state.apiKeySet
                    };
                }
                case 'EXTRACT_OK': {
                    if (state.phase !== 'EXTRACTING' || state.runId !== event.runId)
                        return state;
                    return {
                        phase: 'PREFLIGHT',
                        runId: event.runId,
                        selectedLanguage: state.selectedLanguage,
                        selectedMode: state.selectedMode,
                        apiKeySet: state.apiKeySet,
                        banner: state.banner,
                        article: event.article,
                        estimate: {
                            charCount: event.article.charCount,
                            tokenLow: 0,
                            tokenHigh: 0,
                            chunkCount: 1,
                            costLowUsd: 0,
                            costHighUsd: 0,
                            costWorstUsd: 0,
                            timeLowSec: 0,
                            timeHighSec: 0,
                            model: `${AS.MODEL_FINAL}`,
                            mapModel: AS.MODEL_MAP,
                            finalModel: AS.MODEL_FINAL,
                            maxOutputTokens: AS.getModeRuntimeSpec(state.selectedMode).maxOutputTokens,
                            truncated: false,
                            sentCharCount: event.article.charCount
                        },
                        refining: false
                    };
                }
                case 'EXTRACT_FAIL': {
                    if (state.phase !== 'EXTRACTING' || state.runId !== event.runId)
                        return state;
                    return {
                        phase: 'ERROR',
                        selectedLanguage: state.selectedLanguage,
                        selectedMode: state.selectedMode,
                        apiKeySet: state.apiKeySet,
                        banner: state.banner,
                        message: event.message
                    };
                }
                case 'PREFLIGHT_READY': {
                    if (state.phase !== 'PREFLIGHT' || state.runId !== event.runId)
                        return state;
                    return {
                        ...state,
                        estimate: event.estimate,
                        refining: event.refining,
                        banner: state.banner
                    };
                }
                case 'TOKENS_REFINED': {
                    if (!('runId' in state) || state.runId !== event.runId)
                        return state;
                    if (state.phase === 'PREFLIGHT') {
                        return {
                            ...state,
                            estimate: event.estimate,
                            refining: false
                        };
                    }
                    if (state.phase === 'CONFIRM') {
                        return {
                            ...state,
                            estimate: event.estimate
                        };
                    }
                    return state;
                }
                case 'NEEDS_CONFIRM': {
                    if (state.phase !== 'PREFLIGHT' || state.runId !== event.runId)
                        return state;
                    return {
                        phase: 'CONFIRM',
                        runId: event.runId,
                        selectedLanguage: state.selectedLanguage,
                        selectedMode: state.selectedMode,
                        apiKeySet: state.apiKeySet,
                        banner: state.banner,
                        article: state.article,
                        estimate: event.estimate,
                        note: event.note
                    };
                }
                case 'BLOCKED': {
                    // Can transition from PREFLIGHT
                    if ((state.phase !== 'PREFLIGHT' && state.phase !== 'CONFIRM') || state.runId !== event.runId)
                        return state;
                    return {
                        phase: 'BLOCKED',
                        runId: event.runId,
                        selectedLanguage: state.selectedLanguage,
                        selectedMode: state.selectedMode,
                        apiKeySet: state.apiKeySet,
                        banner: state.banner,
                        estimate: event.estimate,
                        reason: event.reason
                    };
                }
                case 'START_SUMMARY': {
                    if (state.phase === 'PREFLIGHT' || state.phase === 'CONFIRM') {
                        if (state.runId !== event.runId)
                            return state;
                        const willChunk = state.estimate.chunkCount > 1;
                        return {
                            phase: 'SUMMARIZING',
                            runId: event.runId,
                            selectedLanguage: state.selectedLanguage,
                            selectedMode: state.selectedMode,
                            apiKeySet: state.apiKeySet,
                            banner: state.banner,
                            article: state.article,
                            estimate: state.estimate,
                            progress: willChunk
                                ? { stage: 'MAP', current: 0, total: state.estimate.chunkCount }
                                : { stage: 'SINGLE' }
                        };
                    }
                    return state;
                }
                case 'SUMMARY_PROGRESS': {
                    if (state.phase !== 'SUMMARIZING' || state.runId !== event.runId)
                        return state;
                    return {
                        ...state,
                        progress: {
                            stage: event.stage,
                            current: event.current,
                            total: event.total
                        },
                        banner: state.banner
                    };
                }
                case 'SUMMARY_DONE': {
                    if (state.phase !== 'SUMMARIZING' || state.runId !== event.runId)
                        return state;
                    return {
                        phase: 'DONE',
                        runId: event.runId,
                        selectedLanguage: state.selectedLanguage,
                        selectedMode: state.selectedMode,
                        apiKeySet: state.apiKeySet,
                        article: state.article,
                        summaryText: event.summaryText,
                        usage: event.usage,
                        banner: state.banner
                    };
                }
                case 'SUMMARY_ERROR': {
                    if (state.phase !== 'SUMMARIZING' || state.runId !== event.runId)
                        return state;
                    return {
                        phase: 'ERROR',
                        selectedLanguage: state.selectedLanguage,
                        selectedMode: state.selectedMode,
                        apiKeySet: state.apiKeySet,
                        banner: state.banner,
                        message: event.message
                    };
                }
                case 'RESET': {
                    return {
                        phase: 'IDLE',
                        selectedLanguage: state.selectedLanguage,
                        selectedMode: state.selectedMode,
                        apiKeySet: state.apiKeySet,
                        banner: event.banner
                    };
                }
                default:
                    return state;
            }
        }
        StateMachine.reduce = reduce;
    })(StateMachine = AS.StateMachine || (AS.StateMachine = {}));
})(AS || (AS = {}));
