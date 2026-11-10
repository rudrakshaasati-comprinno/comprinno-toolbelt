# Knowledge: AWS GPU Families & LLM Sizing Reference

Reference material for the recommendation agent. This is domain knowledge, not
pricing. Prices always come from the MCP pricing tools. Specs should be
re-validated against the live AWS documentation linked below.

## Grounding rule
Ground every technical claim (specs, families, suitability, purchasing options)
in an authoritative source. Prefer, in order: the AWS documentation MCP for live
doc content, then the reference links in this file. When you state a spec or a
capability in the report, cite the relevant source URL from the "Reference
Documentation" section (or the AWS docs MCP result) so the recommendation is
grounded, not asserted from memory.

## AWS GPU / accelerator instance families

| Family | Accelerator | Arch | Per-GPU mem | Typical use | Docs |
|--------|-------------|------|-------------|-------------|------|
| G5     | NVIDIA A10G | Ampere | 24 GB | Cost-effective inference, small/medium training, graphics | https://aws.amazon.com/ec2/instance-types/g5/ |
| G6     | NVIDIA L4   | Ada    | 24 GB | Efficient inference, video/AI | https://aws.amazon.com/ec2/instance-types/g6/ |
| G6e    | NVIDIA L40S | Ada    | 48 GB | Larger-model inference, mid training | https://aws.amazon.com/ec2/instance-types/g6e/ |
| P4d/P4de | NVIDIA A100 | Ampere | 40/80 GB | Large-scale training, HPC | https://aws.amazon.com/ec2/instance-types/p4/ |
| P5     | NVIDIA H100 | Hopper | 80 GB | Frontier training, largest models | https://aws.amazon.com/ec2/instance-types/p5/ |
| Inf2   | Inferentia2 | Neuron | 32 GB | Cost-efficient inference (needs Neuron SDK compilation) | https://aws.amazon.com/ec2/instance-types/inf2/ |
| Trn1   | Trainium    | Neuron | 32 GB | Cost-efficient large-scale training (Neuron SDK) | https://aws.amazon.com/ec2/instance-types/trn1/ |

Notes:
- Inf2 / Trn1 require compiling the model with the AWS Neuron SDK; verify model
  and framework support before recommending.
- Multi-GPU instances need high interconnect (NVLink / EFA) for distributed work.

## GPU memory estimation heuristics (estimates only)

Bytes per parameter by precision/quantization:
- FP32 = 4, FP16/BF16 = 2, FP8/INT8 = 1, INT4/GPTQ/AWQ = 0.5.

Inference footprint ≈ weights + KV cache + workspace + framework overhead.
- weights_gb = params * bytes_per_param / 1e9
- KV cache grows with context length, batch/concurrency, and model width.
- Add ~10% workspace and ~15% framework/runtime overhead.
- Apply ~15% headroom; never size a GPU to 100% utilisation.

Training footprint ≈ weights + gradients (=weights) + optimizer states
(Adam ≈ 2 states in FP32 ≈ 8 bytes/param) + activations + overhead.
Distributed training adds sharding/communication overhead.

## Bedrock evaluation (inference workloads)

- Match the customer model to a Bedrock model by family; a family match does
  NOT guarantee identical behaviour/performance.
- Monthly tokens = requests/month * tokens/request (in and out separately).
  requests/month = requests_per_second * 3600 * hours (use the USER-PROVIDED
  request rate). NEVER derive a request rate from concurrency by assumption —
  ask for it (see the gpu-advisor skill's references/discovery.md).
- Monthly cost = (monthly_in/1000)*in_price + (monthly_out/1000)*out_price.
- If no equivalent model exists on Bedrock, say so explicitly.

## Purchasing options

- On-Demand: hourly * effective_hours * instances (effective_hours = hours * util).
- Compute Savings Plans: 1yr / 3yr, No / Partial / All Upfront. Longer term and
  more upfront => larger discount. Report effective hourly/monthly/annual,
  upfront, total commitment, savings %, and break-even.
- Not every instance/service qualifies for every plan; only show applicable ones.

## Reference Documentation (cite these to ground the report)

AWS — EC2 GPU instances
- EC2 instance types (overview): https://aws.amazon.com/ec2/instance-types/
- Accelerated computing instances (docs): https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html
- G5: https://aws.amazon.com/ec2/instance-types/g5/
- G6: https://aws.amazon.com/ec2/instance-types/g6/
- G6e: https://aws.amazon.com/ec2/instance-types/g6e/
- P4 (P4d/P4de): https://aws.amazon.com/ec2/instance-types/p4/
- P5: https://aws.amazon.com/ec2/instance-types/p5/
- Inf2: https://aws.amazon.com/ec2/instance-types/inf2/
- Trn1: https://aws.amazon.com/ec2/instance-types/trn1/

AWS — availability, quotas, capacity
- DescribeInstanceTypeOfferings: https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstanceTypeOfferings.html
- EC2 service quotas (On-Demand vCPU limits): https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-resource-limits.html
- On-Demand Capacity Reservations: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-reservations.html
- EC2 Capacity Blocks for ML: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-blocks.html

AWS — pricing & purchasing
- EC2 On-Demand pricing: https://aws.amazon.com/ec2/pricing/on-demand/
- Savings Plans: https://aws.amazon.com/savingsplans/
- Compute Savings Plans (docs): https://docs.aws.amazon.com/savingsplans/latest/userguide/what-is-savings-plans.html
- AWS Price List / Pricing API: https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_Operations_AWS_Price_List_Service.html

AWS — Bedrock (managed inference)
- Bedrock supported foundation models: https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html
- Bedrock pricing: https://aws.amazon.com/bedrock/pricing/
- Bedrock inference (on-demand / provisioned throughput): https://docs.aws.amazon.com/bedrock/latest/userguide/inference.html
- Bedrock Custom Model Import: https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html

AWS — Neuron (Inf2 / Trn1)
- AWS Neuron documentation: https://awsdocs-neuron.readthedocs-hosted.com/
- Neuron supported models & frameworks: https://awsdocs-neuron.readthedocs-hosted.com/en/latest/general/models/index.html

AWS — SageMaker (training / hosting alternative)
- SageMaker developer guide: https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html

NVIDIA GPU specs (GPU memory / architecture grounding)
- A100: https://www.nvidia.com/en-us/data-center/a100/
- H100: https://www.nvidia.com/en-us/data-center/h100/
- L40S: https://www.nvidia.com/en-us/data-center/l40s/
- L4: https://www.nvidia.com/en-us/data-center/l4/
- A10 / A10G: https://www.nvidia.com/en-us/data-center/products/a10-gpu/

Source clouds (baseline)
- Azure Retail Prices API: https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices
- Azure GPU VM sizes (ND/NC series): https://learn.microsoft.com/azure/virtual-machines/sizes-gpu
- GCP GPU platforms: https://cloud.google.com/compute/docs/gpus
- GCP Cloud Billing Catalog API: https://cloud.google.com/billing/docs/reference/rest/v1/services.skus/list

LLM memory sizing references
- vLLM (paged attention / KV cache): https://docs.vllm.ai/en/latest/
- Hugging Face — LLM inference optimization: https://huggingface.co/docs/transformers/main/en/llm_tutorial_optimization
