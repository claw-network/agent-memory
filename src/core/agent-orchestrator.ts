import { asAgentMemoryBundle, bundleOutputSchema, validateBundleShape } from "./bundle-schema";
import { buildDiscoveryPrompt, buildFinalizePrompt } from "./prompt-builder";
import { invokeProvider } from "./provider-adapters";
import { runValidations } from "./run-validations";
import type {
  AgentMemoryBundle,
  CollectedContext,
  ProviderMetadata,
  ProviderPreference,
  ValidationResult,
} from "../types";

export interface OrchestratedMemoryResult {
  provider: ProviderMetadata;
  bundle: AgentMemoryBundle;
  validationResults: ValidationResult[];
  discoveryErrors: string[];
}

export async function orchestrateAgentMemory(
  context: CollectedContext,
  providerPreference: ProviderPreference,
  shouldValidate: boolean,
): Promise<OrchestratedMemoryResult> {
  const discovery = await invokeProvider(providerPreference, {
    cwd: context.cwd,
    prompt: buildDiscoveryPrompt(context),
    schema: bundleOutputSchema,
  });

  const discoveryErrors = validateBundleShape(discovery.parsed);
  const discoveryBundle = asAgentMemoryBundle(discovery.parsed);
  const validationResults: ValidationResult[] =
    shouldValidate && discoveryBundle && discoveryBundle.validationCommands.length > 0
      ? await runValidations(context.cwd, discoveryBundle.validationCommands)
      : [];

  const finalized = await invokeProvider(discovery.provider.name, {
    cwd: context.cwd,
    prompt: buildFinalizePrompt(context, discovery.parsed, discoveryErrors, validationResults),
    schema: bundleOutputSchema,
  });

  const finalErrors = validateBundleShape(finalized.parsed);
  if (finalErrors.length > 0) {
    throw new Error(`Provider returned an invalid memory bundle: ${finalErrors.join(" ")}`);
  }

  return {
    provider: finalized.provider,
    bundle: finalized.parsed as AgentMemoryBundle,
    validationResults,
    discoveryErrors,
  };
}
