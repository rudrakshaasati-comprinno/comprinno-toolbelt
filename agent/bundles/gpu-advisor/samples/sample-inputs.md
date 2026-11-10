# Sample Customer Inputs

Paste any of these into the Kiro agent (`kiro-cli chat --agent gpu-migration-agent`)
or POST to `/recommend` as `{"prompt": "..."}`.

## Example 1 — GCP H100 inference (from the spec)

```
Source Cloud: GCP
Current Instance: a3-highgpu-1g
GPU: NVIDIA H100
GPU Count: 1
GPU Memory: 80 GB
Model: Llama-based LLM
Parameters: 70B
Precision: FP16
Workload: Inference
Context Length: 32K
Concurrent Users: 20
Current Monthly Cost: $5400
Current Region: us-central1
Target AWS Region: us-east-1
```

## Example 2 — Azure A100 fine-tuning

```
Source Cloud: Azure
Current Instance: Standard_NC24ads_A100_v4
GPU: NVIDIA A100 80GB
GPU Count: 1
Model: Mistral 7B
Parameters: 7B
Precision: BF16
Workload: Fine-tuning
Training hours per run: 12
Training runs per month: 8
Current Monthly Cost: $2680
Target AWS Region: us-west-2
```

## Example 3 — sparse input (triggers clarification questions)

```
We run a Llama 70B model on Azure and want to move to AWS. What should we use?
```

## Notes

- The agent extracts a structured profile, asks for missing critical inputs,
  pulls real pricing/specs from the MCP tools, and produces the full report.
- Numbers depend on the MCP tools resolving. AWS pricing requires AWS
  credentials with `pricing:*`. GCP live pricing requires a `GCP_API_KEY`;
  otherwise provide the current monthly cost (as above) for the baseline.
