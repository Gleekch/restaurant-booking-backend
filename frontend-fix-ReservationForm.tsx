import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarIcon, Users, Clock, User, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const ReservationForm = () => {
  const [date, setDate] = useState<Date>();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    guests: "",
    time: "",
    message: ""
  });
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Déterminer si la date sélectionnée est un week-end
  const isWeekend = date ? (date.getDay() === 0 || date.getDay() === 6) : false;
  
  const timeSlots = [
    // Service Midi - dernière arrivée 13h15 (13h45 le week-end)
    "12:00", "12:15", "12:30", "12:45", "13:00", "13:15",
    ...(isWeekend ? ["13:30", "13:45"] : []),
    // Service Soir - dernière arrivée 21h00 (21h30 le week-end)
    "18:30", "18:45", "19:00", "19:15", "19:30", "19:45", "20:00", "20:15", "20:30", "20:45", "21:00",
    ...(isWeekend ? ["21:15", "21:30"] : [])
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !formData.name || !formData.email || !formData.phone || !formData.guests || !formData.time) {
      toast({
        title: "Champs manquants",
        description: "Veuillez remplir tous les champs obligatoires.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      // ENVOI AU BACKEND
      const response = await fetch('https://restaurant-booking-backend-y3sp.onrender.com/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerName: formData.name,
          phoneNumber: formData.phone,
          email: formData.email,
          numberOfPeople: parseInt(formData.guests),
          date: format(date, 'yyyy-MM-dd'),
          time: formData.time,
          source: 'website',
          specialRequests: formData.message || ''
        })
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "✅ Réservation confirmée !",
          description: "Vous allez recevoir un email de confirmation. Merci de votre confiance !",
        });

        // Reset form
        setDate(undefined);
        setFormData({
          name: "",
          email: "",
          phone: "",
          guests: "",
          time: "",
          message: ""
        });
      } else {
        throw new Error(result.message || 'Erreur lors de la réservation');
      }
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Une erreur est survenue. Veuillez réessayer ou nous contacter directement.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <section id="reservation" className="py-20 bg-gradient-to-b from-white to-teal-50">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-teal-800 mb-4">Réserver votre table</h2>
          <p className="text-gray-600 max-w-2xl mx-auto mb-4">
            Réservez dès maintenant votre table et vivez une expérience culinaire inoubliable 
            dans notre restaurant face à l'océan.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 max-w-xl mx-auto">
            <p className="text-sm text-amber-800 font-medium mb-2">📍 Horaires de réservation :</p>
            <div className="grid grid-cols-2 gap-4 text-sm text-amber-700">
              <div>
                <strong>☀️ Service Midi</strong><br/>
                Semaine : 12h00 - 13h15<br/>
                Week-end : 12h00 - 13h45
              </div>
              <div>
                <strong>🌙 Service Soir</strong><br/>
                Semaine : 18h30 - 21h00<br/>
                Week-end : 18h30 - 21h30
              </div>
            </div>
            <p className="text-xs text-amber-600 mt-3 italic">
              Maximum 50 réservations en ligne par service • Réservation possible le jour même
            </p>
          </div>
        </div>

        <Card className="max-w-2xl mx-auto shadow-xl border-0 bg-white/90 backdrop-blur-sm">
          <CardHeader className="bg-teal-700 text-white rounded-t-lg">
            <CardTitle className="text-2xl text-center flex items-center justify-center gap-2">
              <CalendarIcon className="h-6 w-6" />
              Nouvelle réservation
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-teal-700 font-medium flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Nom complet *
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                    placeholder="Votre nom"
                    className="border-teal-200 focus:border-teal-500"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-teal-700 font-medium flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Email *
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange("email", e.target.value)}
                    placeholder="votre@email.com"
                    className="border-teal-200 focus:border-teal-500"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-teal-700 font-medium flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Téléphone *
                  </Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => handleInputChange("phone", e.target.value)}
                    placeholder="06 XX XX XX XX"
                    className="border-teal-200 focus:border-teal-500"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-teal-700 font-medium flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Nombre de personnes *
                  </Label>
                  <Select value={formData.guests} onValueChange={(value) => handleInputChange("guests", value)}>
                    <SelectTrigger className="border-teal-200 focus:border-teal-500">
                      <SelectValue placeholder="Choisir" />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                        <SelectItem key={num} value={num.toString()}>
                          {num} {num === 1 ? "personne" : "personnes"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-teal-700 font-medium flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    Date *
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal border-teal-200 focus:border-teal-500",
                          !date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date ? format(date, "PPP", { locale: fr }) : "Choisir une date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={setDate}
                        disabled={(date) => {
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          return date < today;
                        }}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label className="text-teal-700 font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Heure *
                  </Label>
                  <Select value={formData.time} onValueChange={(value) => handleInputChange("time", value)}>
                    <SelectTrigger className="border-teal-200 focus:border-teal-500">
                      <SelectValue placeholder="Choisir l'heure" />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="text-xs text-gray-500 px-2 py-1 font-medium">
                        {timeSlots.filter(t => parseInt(t.split(':')[0]) < 15).length > 0 && "☀️ Service Midi"}
                      </div>
                      {timeSlots.filter(t => parseInt(t.split(':')[0]) < 15).map((time) => (
                        <SelectItem key={time} value={time}>
                          {time}
                        </SelectItem>
                      ))}
                      <div className="text-xs text-gray-500 px-2 py-1 font-medium mt-2">
                        {timeSlots.filter(t => parseInt(t.split(':')[0]) >= 18).length > 0 && "🌙 Service Soir"}
                      </div>
                      {timeSlots.filter(t => parseInt(t.split(':')[0]) >= 18).map((time) => (
                        <SelectItem key={time} value={time}>
                          {time}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="message" className="text-teal-700 font-medium">
                  Message (optionnel)
                </Label>
                <textarea
                  id="message"
                  value={formData.message}
                  onChange={(e) => handleInputChange("message", e.target.value)}
                  placeholder="Demandes spéciales, allergies, etc."
                  className="w-full p-3 border border-teal-200 rounded-md focus:border-teal-500 focus:outline-none resize-none"
                  rows={3}
                />
              </div>

              <Button 
                type="submit" 
                disabled={isLoading}
                className="w-full bg-teal-700 hover:bg-teal-800 text-white py-4 text-lg rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 disabled:opacity-50"
              >
                {isLoading ? "Envoi en cours..." : "Confirmer la réservation"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};

export default ReservationForm;