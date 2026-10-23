using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Shop.Domain;

[Table("customers")]
public class Customer
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    [MaxLength(120)]
    public string Name { get; set; } = null!;

    [MaxLength(14)]
    public string? Document { get; set; }

    public ICollection<Order> Orders { get; set; } = new List<Order>();
}
