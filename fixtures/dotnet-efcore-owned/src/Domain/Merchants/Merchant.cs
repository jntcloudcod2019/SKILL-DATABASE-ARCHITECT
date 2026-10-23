using Microsoft.EntityFrameworkCore;

namespace Hub.Domain.Merchants;

public class Merchant
{
    public Guid Id { get; set; }
    public string Nome { get; set; } = null!;
    public ConexaoIFood ConexaoIFood { get; set; } = null!;
    public ConfigWhatsApp? WhatsApp { get; set; }
}

[Owned]
public class ConexaoIFood
{
    public string MerchantExternalId { get; set; } = null!;
    public bool Ativo { get; set; }
}

[Owned]
public class ConfigWhatsApp
{
    public string Numero { get; set; } = null!;
}
