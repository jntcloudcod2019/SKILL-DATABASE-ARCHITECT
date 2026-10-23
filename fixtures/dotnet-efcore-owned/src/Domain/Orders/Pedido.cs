using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace Hub.Domain.Orders;

public class Pedido
{
    public Guid Id { get; set; }
    public Guid MerchantId { get; set; }
    public decimal ValorTotal { get; set; }

    // OwnsOne (required): columns Cliente_Nome, Cliente_Telefone in the pedidos table
    public DadosCliente Cliente { get; set; } = null!;
    // OwnsOne (optional) with nested owned type and an explicit column name
    public EnderecoEntrega? Endereco { get; set; }
    // OwnsOne mapped to a single JSON column
    public DadosPagamento Pagamento { get; set; } = null!;
    // custom class stored as jsonb through HasColumnType
    public ReceiptData? ReceiptData { get; set; }
    public JsonDocument? Metadata { get; set; }
    [Column(TypeName = "jsonb")]
    public List<string> Tags { get; set; } = new();
    // OwnsMany -> separate table
    public List<ItemPedido> Itens { get; set; } = new();
}

public class DadosCliente
{
    [MaxLength(120)] public string Nome { get; set; } = null!;
    [MaxLength(20)] public string? Telefone { get; set; }
}

public class EnderecoEntrega
{
    [MaxLength(200)] public string Rua { get; set; } = null!;
    public string? Numero { get; set; }
    public Coordenadas Local { get; set; } = null!;
}

public class Coordenadas
{
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}

public class DadosPagamento
{
    public string Metodo { get; set; } = null!;
    public decimal ValorPago { get; set; }
    public DateTimeOffset? PagoEm { get; set; }
}

public class ReceiptData
{
    public string Numero { get; set; } = null!;
    public List<ReceiptLine> Linhas { get; set; } = new();
}

public class ReceiptLine
{
    public string Descricao { get; set; } = null!;
    public decimal Valor { get; set; }
}

public class ItemPedido
{
    [MaxLength(200)] public string Descricao { get; set; } = null!;
    public int Quantidade { get; set; }
    public decimal PrecoUnitario { get; set; }
}
